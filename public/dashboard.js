//  ГЛОБАЛЬНІ ЗМІННІ 
let myChart = null;
let totalEnergySaved = 0.0; 
let lastStatus = null; // Ця змінна виправляє баг із логами після перезавантаження

document.addEventListener('DOMContentLoaded', async () => {
    checkAccessLevel();
    setupSliders();
    await loadRooms(); // Спочатку вантажимо список кімнат
    setInterval(updateDashboard, 10000); 
});

// ФУНКЦІЯ ПЕРЕВІРКИ ДОСТУПУ
function checkAccessLevel() {
    const isAuth = sessionStorage.getItem('isAuthenticated') === 'true';
    const authBtn = document.getElementById('auth-btn');
    const targetCard = document.getElementById('admin-target-card');
    const simCard = document.getElementById('admin-simulation-card');
    const addRoomBtn = document.getElementById('add-room-btn'); // Отримуємо кнопку

    if (isAuth) {
        if (authBtn) {
            authBtn.innerText = 'Sign Out (Admin)';
            authBtn.onclick = function() {
                sessionStorage.clear();
                window.location.reload();
            };
        }
        if (targetCard) targetCard.style.display = 'block';
        if (simCard) simCard.style.display = 'block';
        if (addRoomBtn) addRoomBtn.style.display = 'block'; // Показуємо адміну
    } else {
        if (authBtn) {
            authBtn.innerText = 'Sign In';
            authBtn.onclick = function() { window.location.href = '/login.html'; };
        }
        if (targetCard) targetCard.style.display = 'none';
        if (simCard) simCard.style.display = 'none';
        if (addRoomBtn) addRoomBtn.style.display = 'none'; // Ховаємо від гостя
    }
}

    // --- ЗАВАНТАЖЕННЯ СПИСКУ КІМНАТ З БАЗИ ---
async function loadRooms() {
    try {
        const response = await fetch('/api/rooms');
        const rooms = await response.json();
        
        const select = document.getElementById('room-select');
        select.innerHTML = ''; 

        rooms.forEach(room => {
            const option = document.createElement('option');
            option.value = room.id;
            option.textContent = room.name; 
            select.appendChild(option);
        });

        if (rooms.length > 0) {
            updateDashboard();
        }
    } catch (error) {
        console.error('Помилка завантаження кімнат:', error);
    }
}

// 2. Логіка оновлення дашборду 
async function updateDashboard() {
    const roomId = document.getElementById('room-select').value;
    if (!roomId) return;

    try {
        // СИНХРОНІЗАЦІЯ ПОВЗУНКІВ 
        const roomsResponse = await fetch('/api/rooms');
        const rooms = await roomsResponse.json();
        const currentRoom = rooms.find(r => r.id == roomId);

        if (currentRoom) {
            // Оновлюємо людей
            const peopleRange = document.getElementById('people-range');
            const peopleVal = document.getElementById('people-val');
            if (peopleRange && peopleVal) {
                peopleRange.value = currentRoom.simulation_people;
                peopleVal.innerText = currentRoom.simulation_people;
            }

            // Оновлюємо потужність кондиціонера (Вт -> кВт)
            const powerRange = document.getElementById('power-range');
            const powerVal = document.getElementById('power-val');
            if (powerRange && powerVal) {
                const kw = currentRoom.ac_power_w / 1000;
                powerRange.value = kw;
                powerVal.innerText = kw.toFixed(1);
            }
            
            // Оновлюємо цільову температуру
            const tempRange = document.getElementById('temp-range');
            const rangeVal = document.getElementById('range-val');
            if (tempRange && rangeVal) {
                tempRange.value = currentRoom.target_temperature;
                rangeVal.innerText = Number(currentRoom.target_temperature).toFixed(1);
            }

            // Оновлюємо зовнішню температуру (Ambient/Outdoor Temp)
            const outdoorRange = document.getElementById('outdoor-temp-range');
            const outdoorVal = document.getElementById('outdoor-temp-val');
            if (outdoorRange && outdoorVal && currentRoom.outdoor_temperature !== undefined) {
                outdoorRange.value = currentRoom.outdoor_temperature;
                outdoorVal.innerText = currentRoom.outdoor_temperature;
            }
        }

        //  ОТРИМАННЯ ПРОГНОЗУ ТА ПРЕЛИКТИВНОЇ МОДЕЛІ 
        const response = await fetch(`/api/predict/${roomId}`);
        const data = await response.json();

        if (!data.success) return;

        // Оновлення поточної температури
        document.getElementById('current-temp').innerText = `${data.currentTemperature} °C`;
        
        // Дані для графіка
        const tempsUncontrolled = data.forecast.map(f => f.tempUncontrolled);
        const tempsControlled = data.forecast.map(f => f.tempControlled);

        // Мітки часу для 8-годинного робочого дня 
        const labels = data.forecast.map(f => {
            if (f.minute % 60 === 0) {
                const hour = 9 + (f.minute / 60);
                return `${hour.toString().padStart(2, '0')}:00`;
            }
            if (f.minute === 1) return '09:00';
            return '';
        });

        // Математика економії за 8 годин 
        let minutesOff = 0;
        for (let i = 1; i < tempsControlled.length; i++) {
            if (tempsControlled[i] >= tempsControlled[i-1]) {
                minutesOff++;
            }
        }
        
        const acPowerKw = parseFloat(document.getElementById('power-range').value) || 3.5;
        const projectedSavings = (minutesOff / 60) * acPowerKw;
        document.getElementById('energy-saved').innerText = `${projectedSavings.toFixed(2)} kWh`;
        
        const ecoText = document.querySelector('#energy-saved').nextElementSibling;
        if (ecoText) ecoText.innerText = `Projected savings (8-hr shift forecast)`;

        // Оновлення статусу HVAC та логування подій
        const badge = document.getElementById('status-badge');
        if (data.proactiveActionNeeded === 'TURN_ON_AC') {
            badge.innerText = 'COOLING (ON)';
            badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200';
            
            if (lastStatus !== 'ON') {
                addLogEvent('HVAC_ON', data.currentTemperature);
                lastStatus = 'ON';
            }
        } else {
            badge.innerText = 'STABLE (OFF)';
            badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200';
            
            if (lastStatus !== 'OFF') {
                addLogEvent('HVAC_OFF', data.currentTemperature);
                lastStatus = 'OFF';
            }
        }

        // Симуляція якості повітря
        const mockCo2 = Math.floor(Math.random() * (600 - 450 + 1) + 450); 
        const mockHum = Math.floor(Math.random() * (50 - 40 + 1) + 40);
        document.getElementById('co2-val').innerText = `${mockCo2} ppm`;
        document.getElementById('humidity-val').innerText = `${mockHum} %`;

        // Малювання графіка Chart.js
        const ctx = document.getElementById('forecastChart').getContext('2d');
        if (myChart) myChart.destroy();

        myChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Uncontrolled Model (No HVAC)',
                        data: tempsUncontrolled,
                        borderColor: '#ef4444',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        backgroundColor: 'transparent',
                        tension: 0.1,
                        pointRadius: 0
                    },
                    {
                        label: 'Adaptive System (Predictive)',
                        data: tempsControlled,
                        borderColor: '#10b981',
                        borderWidth: 3,
                        backgroundColor: 'rgba(16, 185, 129, 0.05)',
                        fill: true,
                        tension: 0.1,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true } },
                scales: {
                    x: { grid: { color: '#f1f5f9' }, ticks: { maxRotation: 0, autoSkip: false } },
                    y: { grid: { color: '#e2e8f0' } }
                }
            }
        });
    } catch (err) { 
        console.error("Update Error:", err); 
    }
}

// ДИНАМІЧНЕ ДОДАВАННЯ РЯДКІВ У ТАБЛИЦЮ ЛОГІВ
function addLogEvent(type, temp) {
    const tbody = document.getElementById('log-table-body');
    if (!tbody) return;
    
    const row = document.createElement('tr');
    const time = new Date().toLocaleTimeString('en-GB', {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    let badgeStr = '';
    let descStr = '';

    if (type === 'HVAC_ON') {
        badgeStr = '<span class="px-2 py-0.5 rounded bg-amber-50 text-amber-600 font-semibold text-xs border border-amber-100">ACTION</span>';
        descStr = `Temperature optimization required. Cooling mode activated at ${temp}°C.`;
    } else {
        badgeStr = '<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 font-semibold text-xs border border-emerald-100">STABLE</span>';
        descStr = `Target climate achieved (${temp}°C). Switched to eco-efficiency mode.`;
    }

    row.innerHTML = `
        <td class="py-3 text-slate-500 text-xs">${time}</td>
        <td>${badgeStr}</td>
        <td class="text-slate-700">${descStr}</td>
    `;

    tbody.insertBefore(row, tbody.firstChild);
    
    if (tbody.children.length > 5) {
        tbody.removeChild(tbody.lastChild);
    }
}

//  ЗБЕРЕЖЕННЯ НАЛАШТУВАНЬ З УСІХ ПОВЗУНКІВ
async function saveSettings() {
    const roomId = document.getElementById('room-select').value;
    if (!roomId) return;

    const data = {
        target_temp: parseFloat(document.getElementById('temp-range').value),
        people: parseInt(document.getElementById('people-range').value),
        ac_power: parseFloat(document.getElementById('power-range').value) * 1000, // кВт -> Вт
        outdoor_temperature: parseFloat(document.getElementById('outdoor-temp-range').value) // Новий параметр
    };
    
    try {
        await fetch(`/api/rooms/${roomId}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        updateDashboard(); // Перемальовуємо прогноз з урахуванням нових параметрів
    } catch (error) { 
        console.error("Save Settings Error:", error); 
    }
}

//  НАЛАШТУВАННЯ ПОВЗУНКІВ
function setupSliders() {
    const sliders = [
        { id: 'temp-range', valId: 'range-val' },
        { id: 'people-range', valId: 'people-val' },
        { id: 'power-range', valId: 'power-val' },
        { id: 'outdoor-temp-range', valId: 'outdoor-temp-val' }
    ];

    sliders.forEach(s => {
        const input = document.getElementById(s.id);
        const val = document.getElementById(s.valId);
        
        if (input && val) {
            input.addEventListener('input', (e) => {
                val.innerText = parseFloat(e.target.value).toFixed(s.id === 'people-range' || s.id === 'outdoor-temp-range' ? 0 : 1);
            });
            // Відправка на сервер, коли користувач відпустив повзунок
            input.addEventListener('change', () => saveSettings());
        }
    });

    // Обробник зміни кімнати
    document.getElementById('room-select').addEventListener('change', () => {
        lastStatus = null; // Скидаємо статус для логів
        updateDashboard(); // Оновлюємо дашборд 
    });
}
