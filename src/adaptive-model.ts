import pool from './db';

export interface PredictionPoint {
    minute: number;
    tempUncontrolled: number; // Спека без кондиціонера 
    tempControlled: number;   // Стабілізація з кондиціонером 
}

export class AdaptiveClimateModel {
    private readonly HEAT_PER_PERSON_W = 100;
    private readonly OUTSIDE_TEMP = 30.0;
    private readonly AC_COOLING_POWER_W = -3500; 

    public async calculatePrediction(roomId: number, currentTemp: number): Promise<PredictionPoint[]> {
    // Дістаємо ВСЕ з БД: і константи приміщення, і налаштування користувача
    const roomQuery = await pool.query(
        'SELECT heat_capacity, thermal_resistance, target_temperature, simulation_people, ac_power_w FROM rooms WHERE id = $1', 
        [roomId]
    );
    
    if (roomQuery.rows.length === 0) throw new Error('Кімнату не знайдено');
    
    const row = roomQuery.rows[0];
    const C = parseFloat(row.heat_capacity);
    const R = parseFloat(row.thermal_resistance);
    const targetTemp = parseFloat(row.target_temperature);
    const peopleCount = parseInt(row.simulation_people); // БЕРЕМО З ПОВЗУНКА
    const acPower = -parseFloat(row.ac_power_w); // БЕРЕМО З ПОВЗУНКА

    // Розрахунок тепла
    const Q_people = peopleCount * 100; // 100 Вт на людину
    const dt = 60; 
    
    let T_uncontrolled = currentTemp;
    let T_controlled = currentTemp;
    let isACOn = currentTemp > (targetTemp + 0.5); 
    const trajectory: PredictionPoint[] = [];

    for (let minute = 1; minute <= 480; minute++) {
    const Q_walls_uncontrolled = (this.OUTSIDE_TEMP - T_uncontrolled) / R;
    T_uncontrolled += ((Q_people + Q_walls_uncontrolled) * dt) / C;

    const Q_walls_controlled = (this.OUTSIDE_TEMP - T_controlled) / R;
    const Q_ac = isACOn ? acPower : 0; 
    T_controlled += ((Q_people + Q_walls_controlled + Q_ac) * dt) / C;

    if (T_controlled <= targetTemp - 0.5) isACOn = false;
    if (T_controlled >= targetTemp + 0.5) isACOn = true;

    trajectory.push({
        minute: minute,
        tempUncontrolled: parseFloat(T_uncontrolled.toFixed(2)),
        tempControlled: parseFloat(T_controlled.toFixed(2))
    });
}
    return trajectory;
}
}