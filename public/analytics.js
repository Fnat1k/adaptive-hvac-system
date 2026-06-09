let weeklyChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadRoomsSelect();
});

async function loadRoomsSelect() {
    try {
        const response = await fetch('/api/rooms');
        const rooms = await response.json();
        
        const select = document.getElementById('analytics-room-select');
        select.innerHTML = '';

        rooms.forEach(room => {
            const option = document.createElement('option');
            option.value = room.id;
            option.textContent = room.name;
            select.appendChild(option);
        });

        select.addEventListener('change', () => loadWeeklyData());

        if (rooms.length > 0) {
            loadWeeklyData();
        }
    } catch (error) {
        console.error("Error loading rooms for analytics:", error);
    }
}

async function loadWeeklyData() {
    const roomId = document.getElementById('analytics-room-select').value;
    if (!roomId) return;

    try {
        const response = await fetch(`/api/analytics/${roomId}`);
        const result = await response.json();

        if (!result.success) return;

        const data = result.data;

        // 1. Рахуємо суми для KPI карток (тільки кВт і CO2)
        const sumKwh = data.reduce((acc, d) => acc + d.savedKwh, 0);
        const sumCo2 = data.reduce((acc, d) => acc + d.savedCo2, 0);

        document.getElementById('total-kwh').innerText = `${sumKwh.toFixed(1)} kWh`;
        document.getElementById('total-co2').innerText = `${sumCo2.toFixed(1)} kg`;

        // 2. Заповнюємо таблицю (тільки кВт і CO2)
        const tbody = document.getElementById('analytics-table-body');
        tbody.innerHTML = '';
        data.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="py-4 font-semibold text-slate-700">${row.day}</td>
                <td class="text-emerald-600 font-bold">${row.savedKwh} kWh</td>
                <td class="text-amber-600 font-medium">${row.savedCo2} kg</td>
            `;
            tbody.appendChild(tr);
        });

        // 3. Малюємо чистий графік Chart.js (одна вісь Y)
        const ctx = document.getElementById('weeklyChart').getContext('2d');
        if (weeklyChart) weeklyChart.destroy();

        weeklyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.day),
                datasets: [
                    {
                        label: 'Energy Saved (kWh)',
                        data: data.map(d => d.savedKwh),
                        backgroundColor: 'rgba(16, 185, 129, 0.7)',
                        borderColor: '#10b981',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Kilowatt-hours (kWh)', color: '#10b981', font: { weight: 'bold' } },
                        grid: { color: '#f1f5f9' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });

    } catch (error) {
        console.error("Error loading weekly analytics charts:", error);
    }
}