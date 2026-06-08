import { Pool } from 'pg';
import dotenv from 'dotenv';

// Завантажуємо змінні середовища
dotenv.config();

// Створюємо пул підключень до PostgreSQL
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'microclimate_db',
    password: process.env.DB_PASSWORD || '12345', 
    port: parseInt(process.env.DB_PORT || '5432', 10),
});

// Перевірка підключення при старті
pool.on('connect', () => {
    console.log('Успішно підключено до бази даних PostgreSQL (microclimate_db)');
});

pool.on('error', (err) => {
    console.error('Помилка бази даних:', err);
});

export default pool;