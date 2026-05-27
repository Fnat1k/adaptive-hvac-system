
interface RoomContext {
    currentTemp: number;     //  (°C)
    targetTemp: number;      // (Setpoint) (°C)
    outdoorTemp: number;     //  (°C)
    expectedOccupancy: number; // Кількість людей за розкладом
}

class AdaptiveClimateController {
    // Теплофізичні коефіцієнти 
    private readonly roomCapacity = 1.5;   
    private readonly wallResistance = 0.8; 
    private readonly humanHeat = 0.1;      //  (кВт)
    private readonly hvacPower = -2.0;     // (кВт)

    /**
     * Розрахунок прогнозованої температури на наступний крок (15 хв)
     */
    public predictNextState(context: RoomContext, hvacLoadPercent: number): number {
        const { currentTemp, outdoorTemp, expectedOccupancy } = context;
        
        const qPeople = expectedOccupancy * this.humanHeat;
        
        const uHvac = this.hvacPower * (hvacLoadPercent / 100);
        
        const qWalls = (currentTemp - outdoorTemp) / this.wallResistance;

        const deltaTemp = (uHvac + qPeople - qWalls) / this.roomCapacity;
        const predictedTemp = currentTemp + deltaTemp;

        return predictedTemp;
    }

    /**
     *  підбір потужності для утримання Setpoint
     */
    public calculateAdaptiveAction(context: RoomContext): number {
        console.log(`[Аналіз] Поточна: ${context.currentTemp}°C | Цільова: ${context.targetTemp}°C`);
        console.log(`[Розклад] Очікується людей: ${context.expectedOccupancy}`);

        
        let predictedTemp = this.predictNextState(context, 0);
        console.log(`[Прогноз] Температура через 15 хв без HVAC: ${predictedTemp.toFixed(2)}°C`);

        
        if (predictedTemp > context.targetTemp + 0.5) {
            console.log(`[Дія] Виявлено відхилення прогнозу. Розрахунок керуючого впливу...`);
            
            for (let load = 10; load <= 100; load += 10) {
                predictedTemp = this.predictNextState(context, load);
                if (predictedTemp <= context.targetTemp) {
                    console.log(`[Успіх] Оптимальна потужність HVAC: ${load}%`);
                    return load;
                }
            }
            return 100; // Якщо не справляється - вмикаємо на максимум
        }

        console.log(`[Дія] Втручання не потрібне. HVAC: 0%`);
        return 0;
    }
}

// === TEST ===
const controller = new AdaptiveClimateController();

//  зараз нормально (22.5), але за розкладом прийде 30 людей
const testContext: RoomContext = {
    currentTemp: 22.5,
    targetTemp: 22.0,
    outdoorTemp: 28.0,      // На вулиці спекотно
    expectedOccupancy: 30   // Початок лекції
};

controller.calculateAdaptiveAction(testContext);