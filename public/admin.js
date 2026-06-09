let editingRoomId = null; 

document.addEventListener('DOMContentLoaded', () => {
    const isAuth = sessionStorage.getItem('isAuthenticated') === 'true';
    if (!isAuth) {
        window.location.href = '/index.html';
        return;
    }
    loadRoomsTable();
});

function logout() {
    sessionStorage.clear();
    window.location.href = '/index.html';
}

async function loadRoomsTable() {
    try {
        const response = await fetch('/api/rooms');
        const rooms = await response.json();
        const tbody = document.getElementById('rooms-table-body');
        tbody.innerHTML = '';

        rooms.forEach(room => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="py-4 font-mono text-slate-400">#${room.id}</td>
                <td class="font-semibold text-slate-700">${room.name}</td>
                <td>${room.simulation_people} pers.</td>
                <td>${(room.ac_power_w / 1000).toFixed(1)} kW</td>
                <td class="text-right">
                    <button onclick="openModal(${room.id}, '${room.name}', ${room.simulation_people}, ${room.ac_power_w})" class="text-blue-500 hover:text-blue-700 text-xs font-bold uppercase tracking-wider transition mr-3">Edit</button>
                    <button onclick="deleteRoom(${room.id})" class="text-red-500 hover:text-red-700 text-xs font-bold uppercase tracking-wider transition">Delete</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) { console.error("Error loading rooms:", error); }
}

// --- УПРАВЛІННЯ МОДАЛЬНИМ ВІКНОМ ---
function openModal(id = null, name = '', people = 15, power = 3500) {
    editingRoomId = id; 
    
    document.getElementById('room-modal').classList.remove('hidden');
    document.getElementById('modal-title').innerText = id ? 'Edit Room' : 'Create New Room';
    
    // Заповнюємо поля
    document.getElementById('modal-name').value = name;
    document.getElementById('modal-people').value = people;
    document.getElementById('modal-power').value = power;
}

function closeModal() {
    document.getElementById('room-modal').classList.add('hidden');
    editingRoomId = null;
}

// --- ЗБЕРЕЖЕННЯ АБО ОНОВЛЕННЯ (POST / PUT) ---
async function saveRoom() {
    const name = document.getElementById('modal-name').value;
    const people = document.getElementById('modal-people').value;
    const power = document.getElementById('modal-power').value;
    const initTemp = document.getElementById('modal-init-temp').value; 

    if (!name) return alert('Room name is required!');

    const method = editingRoomId ? 'PUT' : 'POST';
    const url = editingRoomId ? `/api/rooms/${editingRoomId}` : '/api/rooms';
    
    // 1. Дістаємо токен із пам'яті браузера
    const token = localStorage.getItem('jwt_token');

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 
                'Content-Type': 'application/json',
                // 2. Додаємо токен у заголовки запиту
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ 
                name: name, 
                simulation_people: parseInt(people), 
                ac_power_w: parseInt(power),
                target_temperature: parseFloat(initTemp) 
            })
        });

        const data = await response.json();
        if (data.success) {
            closeModal();
            loadRoomsTable();
        } else {
            // Якщо токен недійсний або його немає
            alert('Помилка доступу: ' + (data.error || 'Unauthorized'));
        }
    } catch (error) { 
        console.error("Save error:", error); 
    }
}

// --- ВИДАЛЕННЯ КІМНАТИ ---
async function deleteRoom(id) {
    if (!confirm('Are you sure you want to delete this room?')) return;

    // 1. Дістаємо токен із пам'яті браузера
    const token = localStorage.getItem('jwt_token');

    try {
        const response = await fetch(`/api/rooms/${id}`, { 
            method: 'DELETE',
            headers: {
                // 2. Додаємо токен у заголовки запиту
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        if (data.success) {
            loadRoomsTable(); 
        } else {
            alert('Помилка доступу: ' + (data.error || 'Unauthorized'));
        }
    } catch (error) { 
        console.error("Delete error:", error); 
    }
}