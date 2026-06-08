import express from 'express';
import pool from './db';
import { AdaptiveClimateModel } from './adaptive-model';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Наша прогностична модель
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

// ГОЛОВНИЙ АПІ: Запит прогнозу для кімнати та управління обладнанням
app.get('/api/predict/:roomId', async (req, res) => {
    try {
        const roomId = parseInt(req.params.roomId, 10);
        // Імітуємо, що поточна температура 22 градуси
        const currentTemperature = 22.0; 

        // 1. Отримуємо прогноз від моделі
        const prediction = await climateModel.calculatePrediction(roomId, currentTemperature);
        
        // 2. Аналізуємо прогноз: чи потрібне охолодження?
        const needsCooling = prediction.some(p => p.hvacActionRequired);
        const actionNeeded = needsCooling ? 'TURN_ON_AC' : 'NONE';

        // 3. Блок управління обладнанням (Запис у БД)
        let equipmentUpdated = false;
        
        if (needsCooling) {
            // Шукаємо вимкнений кондиціонер у цій кімнаті
            const targetDevice = await pool.query(
                `SELECT id FROM devices 
                 WHERE room_id = $1 AND device_type = 'HVAC_AC' AND status = 'OFF'`,
                [roomId]
            );

            // Якщо знайшли — вмикаємо його
            if (targetDevice.rows.length > 0) {
                const deviceId = targetDevice.rows[0].id;
                await pool.query(
                    `UPDATE devices SET status = 'ON' WHERE id = $1`,
                    [deviceId]
                );
                equipmentUpdated = true;
                console.log(`[Автоматизація] Кондиціонер (ID: ${deviceId}) увімкнено!`);
            }
        }

        // 4. Повертаємо фінальний результат клієнту
        res.json({
            success: true,
            roomId: roomId,
            currentTemperature: currentTemperature,
            proactiveActionNeeded: actionNeeded,
            equipmentStateChanged: equipmentUpdated,
            forecast: prediction 
        });

    } catch (error: any) {
        console.error('Помилка моделі:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущено на http://localhost:${PORT}`);
});