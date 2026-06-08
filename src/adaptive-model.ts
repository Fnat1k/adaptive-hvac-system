import pool from './db';

// Інтерфейс для результату прогнозу
export interface PredictionResult {
    timeOffsetMinutes: number;
    predictedTemp: number;
    hvacActionRequired: boolean;
}

export class AdaptiveClimateModel {
    private readonly HEAT_PER_PERSON_W = 100; // Вт тепла від однієї людини
    private readonly TARGET_TEMP = 22.0; // Цільова комфортна температура
    private readonly OUTSIDE_TEMP = 30.0; // Для тесту: на вулиці спека

    /**
     * Розраховує прогноз температури для конкретної кімнати
     */
    public async calculatePrediction(roomId: number, currentTemp: number): Promise<PredictionResult[]> {
        // 1. Отримуємо фізичні параметри кімнати
        const roomQuery = await pool.query(
            'SELECT heat_capacity, thermal_resistance FROM rooms WHERE id = $1',
            [roomId]
        );
        
        if (roomQuery.rows.length === 0) {
            throw new Error('Кімнату не знайдено');
        }
        
        const C = parseFloat(roomQuery.rows[0].heat_capacity);
        const R = parseFloat(roomQuery.rows[0].thermal_resistance);

        // 2. Отримуємо розклад (скільки людей буде зараз або найближчим часом)
        const scheduleQuery = await pool.query(
            `SELECT expected_people FROM schedules 
             WHERE room_id = $1 AND start_time <= NOW() + interval '1 hour' AND end_time >= NOW()`,
            [roomId]
        );

        let peopleCount = 0;
        if (scheduleQuery.rows.length > 0) {
            peopleCount = scheduleQuery.rows[0].expected_people;
        }

        const Q_people = peopleCount * this.HEAT_PER_PERSON_W;
        
        // 3. Симулюємо зміну температури на 60 хвилин вперед (крок 1 хвилина)
        const dt = 60; // 60 секунд = 1 хвилина
        let T = currentTemp;
        const trajectory: PredictionResult[] = [];

        for (let minute = 1; minute <= 60; minute++) {
            // Теплові втрати (або надходження) через стіни
            const Q_walls = (this.OUTSIDE_TEMP - T) / R; 
            
            // Загальний тепловий баланс
            const Q_total = Q_people + Q_walls;

            // Зміна температури
            const deltaT = (Q_total * dt) / C;
            T = T + deltaT;

            trajectory.push({
                timeOffsetMinutes: minute,
                predictedTemp: parseFloat(T.toFixed(2)),
                // Якщо прогноз показує, що стане спекотніше 24 градусів — треба діяти проактивно
                hvacActionRequired: T > 24.0 
            });
        }

        return trajectory;
    }
}