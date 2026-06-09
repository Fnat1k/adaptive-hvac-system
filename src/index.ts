import express from 'express';
import pool from './db';
import { AdaptiveClimateModel } from './adaptive-model';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
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
app.post('/api/rooms', async (req, res) => {
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
app.delete('/api/rooms/:id', async (req, res) => {
    try {
        const roomId = req.params.id;
        // Видаляємо кімнату (зв'язані пристрої та телеметрію варто теж видаляти каскадно, але поки вистачить цього)
        await pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Помилка видалення:', error);
        res.status(500).json({ success: false, error: 'Помилка видалення' });
    }
});
    // ---  Оновлення кімнати  ---
app.put('/api/rooms/:id', async (req, res) => {
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

app.listen(PORT, () => {
    console.log(`Сервер запущено на http://localhost:${PORT}`);
});