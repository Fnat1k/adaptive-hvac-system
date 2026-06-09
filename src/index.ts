import express from 'express';
import jwt from 'jsonwebtoken';
const JWT_SECRET = 'smart_climate_secret_2026';
import pool from './db';
import { AdaptiveClimateModel } from './adaptive-model';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для валідації JWT-токена
const authenticateJWT = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const token = authHeader.split(' ')[1]; // Відсікаємо слово "Bearer"

        jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
            if (err) {
                return res.status(403).json({ success: false, error: 'Token is invalid or expired' });
            }
            req.user = user;
            next(); // Токен правильний, пропускаємо запит далі
        });
    } else {
        res.status(401).json({ success: false, error: 'Unauthorized: Missing token' });
    }
};

app.use(express.json());
//  Авторизація та видача JWT 
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    // Перевірка адміна
    if (username === 'admin' && password === 'admin') {
        // Генеруємо токен. Він містить роль "admin" і діє 8 годин.
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
        
        // Відправляємо токен на фронтенд
        res.json({ success: true, token: token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
});
app.use(express.static('public')); 

// прогностична модель
const climateModel = new AdaptiveClimateModel();

// Тестовий маршрут бази
app.get('/api/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() AS db_time');
        res.json({ success: true, time: result.rows[0].db_time });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Помилка БД' });
    }
});

// Аналіз телеметрії, розрахунок прогнозу та двостороннє управління
app.get('/api/predict/:roomId', async (req, res) => {
    try {
        const roomId = parseInt(req.params.roomId, 10);

        //  Отримуємо останній реальний запис температури з датчика для цієї кімнати
        const latestTelemetry = await pool.query(
            `SELECT t.temperature FROM telemetry t
             JOIN devices d ON t.device_id = d.id
             WHERE d.room_id = $1 AND d.device_type = 'SENSOR_DHT22'
             ORDER BY t.recorded_at DESC LIMIT 1`,
            [roomId]
        );

        // Якщо датчик ще нічого не надсилав, беремо дефолтні 22 градуси як резерв
        const currentTemperature = latestTelemetry.rows.length > 0 
            ? parseFloat(latestTelemetry.rows[0].temperature) 
            : 22.0;

        //  Отримуємо прогноз від математичної модели
        const prediction = await climateModel.calculatePrediction(roomId, currentTemperature);

        // якщо некерована температура вийде за 24°C, значить загроза є!
        const needsCooling = prediction.some(p => p.tempUncontrolled > 24.0);
        const actionNeeded = needsCooling ? 'TURN_ON_AC' : 'TURN_OFF_AC';

        let equipmentStateChanged = false;

        if (needsCooling) {
            //  Шукаємо вимкнений кондиціонер і вмикаємо його
            const targetDevice = await pool.query(
                `SELECT id FROM devices WHERE room_id = $1 AND device_type = 'HVAC_AC' AND status = 'OFF'`,
                [roomId]
            );

            if (targetDevice.rows.length > 0) {
                await pool.query(`UPDATE devices SET status = 'ON' WHERE id = $1`, [targetDevice.rows[0].id]);
                equipmentStateChanged = true;
                console.log(`[Автоматизація] Прогноз незадовільний. Кондиціонер увімкнено.`);
            }
        } else {
            //  Якщо все в нормі, але кондиціонер працює — вимикаємо його для економії
            const targetDevice = await pool.query(
                `SELECT id FROM devices WHERE room_id = $1 AND device_type = 'HVAC_AC' AND status = 'ON'`,
                [roomId]
            );

            if (targetDevice.rows.length > 0) {
                await pool.query(`UPDATE devices SET status = 'OFF' WHERE id = $1`, [targetDevice.rows[0].id]);
                equipmentStateChanged = true;
                console.log(`[Автоматизація] Стабілізація досягнута або приміщення порожнє. Кондиціонер вимкнено.`);
            }
        }

        // 
        res.json({
            success: true,
            roomId: roomId,
            currentTemperature: currentTemperature,
            proactiveActionNeeded: actionNeeded,
            equipmentStateChanged: equipmentStateChanged,
            forecast: prediction 
        });

    } catch (error: any) {
        console.error('Помилка управління:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
  
//  Прийом телеметрії від пристрою
app.post('/api/telemetry', async (req, res) => {
    try {
        const { deviceId, temperature, humidity, co2_ppm } = req.body;

        // Валідація вхідних даних
        if (!deviceId || temperature === undefined) {
            return res.status(400).json({ success: false, message: 'Неповні дані від датчика' });
        }

        // Записуємо нову телеметрію в базу даних
        await pool.query(
            `INSERT INTO telemetry (device_id, temperature, humidity, co2_ppm) 
             VALUES ($1, $2, $3, $4)`,
            [deviceId, temperature, humidity, co2_ppm || null]
        );

        console.log(`[Телеметрія] Отримано дані від датчика ${deviceId}: T=${temperature}°C, H=${humidity}%`);

        res.json({ success: true, message: 'Телеметрію успішно збережено' });
    } catch (error: any) {
        console.error('Помилка збереження телеметрії:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// Отримати список усіх кімнат для випадаючого списку
app.get('/api/rooms', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM rooms ORDER BY id ASC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ success: false, error: 'Помилка отримання кімнат' });
    }
});

//  Змінити цільову температуру для кімнати
app.post('/api/rooms/:id/settings', async (req, res) => {
    try {
        const { target_temp, people, ac_power } = req.body;
        const roomId = req.params.id;
        
        await pool.query(
            'UPDATE rooms SET target_temperature = $1, simulation_people = $2, ac_power_w = $3 WHERE id = $4', 
            [target_temp, people, ac_power, roomId]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Помилка оновлення налаштувань' });
    }
});

    // --- Створення нової кімнати ---
app.post('/api/rooms', authenticateJWT, async (req, res) => {
    try {
        // Забираємо target_temperature з запиту фронтенду
        const { name, simulation_people, ac_power_w, target_temperature } = req.body;
        
        const heat_capacity = 8000000;     
        const thermal_resistance = 0.012;   

        const result = await pool.query(
            `INSERT INTO rooms (name, heat_capacity, thermal_resistance, target_temperature, simulation_people, ac_power_w) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [name, heat_capacity, thermal_resistance, target_temperature || 22.0, simulation_people, ac_power_w]
        );
        res.json({ success: true, roomId: result.rows[0].id });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Помилка бази даних' });
    }
});

// ---  Видалення кімнати ---
app.delete('/api/rooms/:id', authenticateJWT, async (req, res) => {
    try {
        const roomId = req.params.id;

        // 1. Видаляємо телеметрію тих пристроїв, які належать цій кімнаті
        await pool.query(
            'DELETE FROM telemetry WHERE device_id IN (SELECT id FROM devices WHERE room_id = $1)', 
            [roomId]
        ); 
        
        // 2. Тепер безпечно видаляємо самі пристрої в цій кімнаті
        await pool.query('DELETE FROM devices WHERE room_id = $1', [roomId]); 
        
        // 3. Видаляємо розклади
        await pool.query('DELETE FROM schedules WHERE room_id = $1', [roomId]); 
        
        // 4. І тільки тепер безпечно видаляємо саму кімнату з таблиці rooms
        await pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);

        res.json({ success: true });
    } catch (error) {
        console.error('Помилка видалення:', error);
        res.status(500).json({ success: false, error: 'Помилка бази даних при видаленні' });
    }
});
    // ---  Оновлення кімнати  ---
app.put('/api/rooms/:id', authenticateJWT, async (req, res) => {
    try {
        const roomId = req.params.id;
        const { name, simulation_people, ac_power_w } = req.body;
        
        await pool.query(
            'UPDATE rooms SET name = $1, simulation_people = $2, ac_power_w = $3 WHERE id = $4',
            [name, simulation_people, ac_power_w, roomId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Помилка оновлення кімнати:', error);
        res.status(500).json({ success: false, error: 'Помилка оновлення' });
    }
});
// 3.  Авторизація 
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        // Шукаємо користувача в базі
        const user = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        
        // Перевіряємо пароль ('admin')
        if (user.rows.length > 0 && password === 'admin') { 
            res.json({ success: true, role: user.rows[0].role });
        } else {
            res.status(401).json({ success: false, message: 'Невірний логін або пароль' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: 'Помилка авторизації' });
    }
});

    //  Отримання 5-денної аналітики для конкретної кімнати 
app.get('/api/analytics/:roomId', async (req, res) => {
    try {
        const roomId = req.params.roomId;
        
        // Отримуємо параметри кімнати, щоб від них відштовхнутися
        const roomResult = await pool.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
        if (roomResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Кімнату не знайдено' });
        }
        
        const room = roomResult.rows[0];
        const acPowerKw = room.ac_power_w / 1000;
        const people = room.simulation_people;

        // Генерація історичних даних за 5 днів (Понеділок - П'ятниця)
        // Базова економія залежить від людей (чим більше людей, тим частіше кондиціонер працює, але предиктивна система економить більше)
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const businessTariff = 8.0; // Тариф на світло для бізнесу (грн/кВт·год)
        const co2Factor = 0.45;     // Коефіцієнт викидів CO2 в Україні (кг/кВт·год)

        const analyticsData = days.map((day, index) => {
            // Випадковий коефіцієнт погоди (від 0.7 до 1.3), щоб графік не був плоскою лінією
            const weatherFactor = 0.7 + Math.random() * 0.6;
            
            // Рахуємо базові кВт·год: приблизно від 20% до 50% від максимальної роботи кондера за 8 годин
            const savedKwh = parseFloat((acPowerKw * 8 * (0.2 + (people * 0.005)) * weatherFactor).toFixed(2));
            const savedUah = parseFloat((savedKwh * businessTariff).toFixed(2));
            const savedCo2 = parseFloat((savedKwh * co2Factor).toFixed(2));

            return {
                day,
                savedKwh,
                savedUah,
                savedCo2
            };
        });

        res.json({
            success: true,
            roomName: room.name,
            data: analyticsData
        });
    } catch (error) {
        console.error('Помилка аналітики:', error);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущено на http://localhost:${PORT}`);
});