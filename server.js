const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.CLIENT_URL || "*",
        methods: ["GET", "POST"]
    }
});

const SECRET_KEY = process.env.JWT_SECRET || 'intercodigos_secret_123';

// Crear directorios necesarios
const directories = ['./uploads', './public', './backups'];
directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
        console.log(`📁 Directorio creado: ${dir}`);
    }
});

// Configuración de Multer para subir imágenes
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = 'fixture_' + Date.now() + ext;
        cb(null, name);
    }
});

const upload = multer({ 
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB máximo
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos JPEG, PNG o WebP'));
        }
    }
});

// Base de datos SQLite
const db = new sqlite3.Database('intercodigos.db', (err) => {
    if (err) {
        console.error('❌ Error al conectar con la base de datos:', err);
        process.exit(1);
    } else {
        console.log('✅ Conectado a la base de datos SQLite');
    }
});

// Inicializar base de datos
db.serialize(() => {
    // Crear tabla de partidos
    db.run(`CREATE TABLE IF NOT EXISTS partidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        equipo1 TEXT NOT NULL,
        equipo2 TEXT NOT NULL,
        puntaje1 INTEGER DEFAULT 0,
        puntaje2 INTEGER DEFAULT 0,
        minuto INTEGER DEFAULT 0,
        estado TEXT DEFAULT 'En espera',
        jugadores TEXT,
        jugadores1 TEXT,
        jugadores2 TEXT,
        sanciones TEXT,
        observaciones TEXT,
        inicio_minuto INTEGER DEFAULT NULL,
        start_time DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('❌ Error creando tabla partidos:', err.message);
    });

    // Crear índices
    db.run(`CREATE INDEX IF NOT EXISTS idx_partidos_estado ON partidos (estado)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_partidos_created_at ON partidos (created_at)`);

    // Crear tabla de comentarios SIEMPRE
    db.run(`CREATE TABLE IF NOT EXISTS comentarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        texto TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('❌ Error creando tabla comentarios:', err.message);
        } else {
            console.log('✅ Tabla comentarios verificada/creada');
        }
    });

    // Crear tabla de fixtures
    db.run(`CREATE TABLE IF NOT EXISTS fixtures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        imagen TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('❌ Error creando tabla fixtures:', err.message);
    });

    // Agregar columnas nuevas si no existen (para compatibilidad)
    const alterTableQueries = [
        "ALTER TABLE partidos ADD COLUMN jugadores1 TEXT",
        "ALTER TABLE partidos ADD COLUMN jugadores2 TEXT", 
        "ALTER TABLE partidos ADD COLUMN observaciones TEXT",
        "ALTER TABLE partidos ADD COLUMN inicio_minuto INTEGER",
        "ALTER TABLE partidos ADD COLUMN start_time DATETIME",
        "ALTER TABLE partidos ADD COLUMN elapsed_time INTEGER DEFAULT 0"
    ];

    alterTableQueries.forEach(query => {
        db.run(query, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.log('ℹ️ Columna ya existe o error menor:', err.message);
            }
        });
    });

    console.log('🔧 Base de datos inicializada correctamente');
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Middleware de autenticación JWT
const authenticateAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token no proporcionado' });
    
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'admin') throw new Error('No autorizado');
        next();
    } catch (err) {
        res.status(401).json({ error: 'Token inválido' });
    }
};

// Ruta de login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'intercodigos123') {
        const token = jwt.sign({ role: 'admin' }, SECRET_KEY, { expiresIn: '1h' });
        res.json({ token });
    } else {
        res.status(401).json({ error: 'Credenciales inválidas' });
    }
});

// Rutas principales
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Ruta para subir fixture
app.post('/upload-fixture', authenticateAdmin, (req, res) => {
    upload.single('fixture')(req, res, (err) => {
        if (err) {
            console.error('❌ Error en upload:', err);
            return res.status(400).json({ error: err.message });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No se seleccionó ningún archivo' });
        }

        const stmt = db.prepare("INSERT INTO fixtures (imagen) VALUES (?)");
        stmt.run([req.file.filename], function(err) {
            if (err) {
                console.error('❌ Error guardando fixture en DB:', err);
                return res.status(500).json({ error: 'Error guardando en base de datos' });
            }
            
            console.log('✅ Fixture subido:', req.file.filename);
            emitFixturesUpdate();
            res.json({ 
                message: 'Fixture subido exitosamente', 
                filename: req.file.filename 
            });
        });
        stmt.finalize();
    });
});

// Funciones auxiliares
function getFixtures() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM fixtures ORDER BY created_at DESC", (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}


// Obtiene partidos y calcula el tiempo en vivo antes de enviar
function getPartidosConTiempo() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM partidos 
                ORDER BY CASE estado 
                    WHEN 'Jugando' THEN 1 
                    WHEN 'En espera' THEN 2 
                    WHEN 'Acabado' THEN 3 
                    ELSE 4 
                END, created_at DESC`, (err, partidos) => {
            if (err) return reject(err);
            // Calcula el tiempo en segundos para cada partido
            const partidosConTiempo = (partidos || []).map(p => {
                let elapsed = p.elapsed_time || 0;
                // Solo sumar segundos si está Jugando y tiene start_time
                if (p.estado === 'Jugando' && p.start_time) {
                    const start = new Date(p.start_time).getTime();
                    elapsed += Math.floor((Date.now() - start) / 1000);
                }
                // Si está Pausado, Acabado o En espera, mostrar solo elapsed_time
                return {
                    ...p,
                    tiempo: elapsed // en segundos
                };
            });
            resolve(partidosConTiempo);
        });
    });
}

function getComentarios() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM comentarios ORDER BY created_at DESC", (err, comentarios) => {
            if (err) reject(err);
            else resolve(comentarios || []);
        });
    });
}

function emitPartidosUpdate() {
    getPartidosConTiempo().then(partidos => {
        io.emit('partidos_update', partidos);
        console.log(`📡 Enviados ${partidos.length} partidos a todos los clientes (con tiempo en vivo)`);
    }).catch(err => {
        console.error('❌ Error emitiendo partidos:', err);
        io.emit('partidos_update', []);
    });
}

function emitComentariosUpdate() {
    getComentarios().then(comentarios => {
        io.emit('comentarios_update', comentarios);
        console.log(`📡 Enviados ${comentarios.length} comentarios a todos los clientes`);
    }).catch(err => {
        console.error('❌ Error emitiendo comentarios:', err);
        io.emit('comentarios_update', []);
    });
}

function emitFixturesUpdate() {
    getFixtures().then(fixtures => {
        io.emit('fixture_update', fixtures);
        console.log(`📡 Enviados ${fixtures.length} fixtures a todos los clientes`);
    }).catch(err => {
        console.error('❌ Error emitiendo fixtures:', err);
        io.emit('fixture_update', []);
    });
}

// Backup automático
function backupDatabase() {
    const backupFile = path.join('./backups', `intercodigos_${new Date().toISOString().split('T')[0]}.db`);
    fs.copyFileSync('intercodigos.db', backupFile);
    console.log(`✅ Backup creado: ${backupFile}`);
    
    // Eliminar backups antiguos (mantener últimos 7 días)
    const files = fs.readdirSync('./backups').sort().slice(0, -7);
    files.forEach(file => fs.unlinkSync(path.join('./backups', file)));
}
setInterval(backupDatabase, 24 * 60 * 60 * 1000);
backupDatabase();

// Limpieza de datos antiguos
function cleanOldData() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    db.run(`DELETE FROM comentarios WHERE created_at < ?`, [thirtyDaysAgo], (err) => {
        if (err) console.error('❌ Error eliminando comentarios antiguos:', err);
        else console.log('🗑️ Comentarios antiguos eliminados');
    });
    db.run(`DELETE FROM fixtures WHERE created_at < ?`, [thirtyDaysAgo], (err) => {
        if (err) console.error('❌ Error eliminando fixtures antiguos:', err);
        else console.log('🗑️ Fixtures antiguos eliminados');
    });
}
setInterval(cleanOldData, 24 * 60 * 60 * 1000);
cleanOldData();

// Socket.io manejo de conexiones
// Temporizador global para emitir partidos_update cada segundo si hay partidos Jugando
let partidosInterval = null;
function iniciarEmisionPartidosEnVivo() {
    if (partidosInterval) return; // Ya está corriendo
    partidosInterval = setInterval(() => {
        db.get("SELECT COUNT(*) as jugando FROM partidos WHERE estado = 'Jugando'", (err, row) => {
            if (err) return;
            if (row && row.jugando > 0) {
                emitPartidosUpdate();
            }
        });
    }, 1000);
}
function detenerEmisionPartidosEnVivo() {
    if (partidosInterval) {
        clearInterval(partidosInterval);
        partidosInterval = null;
    }
}

// Iniciar el temporizador al arrancar el servidor
iniciarEmisionPartidosEnVivo();

// Opcional: detener el temporizador si no hay partidos Jugando por mucho tiempo (no necesario en la mayoría de casos)
io.on('connection', (socket) => {
    console.log('👤 Usuario conectado:', socket.id);
    
    // Permitir conexiones públicas y admin. Validar token solo en eventos admin.
    function requireAdminToken(cb) {
        const token = socket.handshake.auth?.token;
        if (!token) {
            console.warn(`⚠️  [${socket.id}] Token no proporcionado, se requiere autenticación`);
            socket.emit('auth_required', { message: 'Token requerido para esta acción' });
            return;
        }
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            if (decoded.role !== 'admin') throw new Error('No autorizado');
            cb();
        } catch (err) {
            console.warn(`⚠️  [${socket.id}] Token inválido: ${err.message}`);
            socket.emit('auth_required', { message: 'Token inválido o expirado' });
        }
    }

    // Enviar SIEMPRE datos iniciales al conectar (público y admin)
    getPartidosConTiempo().then(partidos => {
        socket.emit('partidos_update', partidos);
        console.log(`➡️ Enviados ${partidos.length} partidos a ${socket.id} al conectar`);
    });
    getComentarios().then(comentarios => {
        socket.emit('comentarios_update', comentarios);
        console.log(`➡️ Enviados ${comentarios.length} comentarios a ${socket.id} al conectar`);
    });
    getFixtures().then(fixtures => {
        socket.emit('fixture_update', fixtures);
        console.log(`➡️ Enviados ${fixtures.length} fixtures a ${socket.id} al conectar`);
    });

    socket.on('solicitar_partidos', () => {
    getPartidosConTiempo().then(partidos => socket.emit('partidos_update', partidos));
    });

    socket.on('solicitar_comentarios', () => {
        getComentarios().then(comentarios => socket.emit('comentarios_update', comentarios));
    });

    socket.on('solicitar_fixtures', () => {
        getFixtures().then(fixtures => socket.emit('fixture_update', fixtures));
    });

    socket.on('update_partido', (data) => {
        requireAdminToken(() => {
            // ...código original de update_partido aquí...
            console.log('🔄 Actualizando partido:', data);
            if (!data.id) {
                console.error('❌ ID de partido no proporcionado');
                socket.emit('error', { message: 'ID de partido requerido' });
                return;
            }
            db.get('SELECT estado, minuto, inicio_minuto, start_time, elapsed_time FROM partidos WHERE id = ?', [data.id], (err, partido) => {
                if (err || !partido) {
                    console.error('❌ Error obteniendo partido:', err);
                    socket.emit('error', { message: 'Error obteniendo partido' });
                    return;
                }
                let query = `UPDATE partidos SET `;
                let params = [];
                let updates = [];
                let now = Math.floor(Date.now() / 1000); // segundos
                let nowISO = new Date().toISOString();
                if (data.estado !== undefined) {
                    updates.push('estado = ?');
                    params.push(data.estado);
                    if (data.estado === 'Jugando' && !partido.start_time) {
                        updates.push('start_time = ?');
                        params.push(nowISO);
                    }
                    if (data.estado === 'Pausado' && partido.start_time) {
                        let start = Math.floor(new Date(partido.start_time).getTime() / 1000);
                        let transcurridos = now - start;
                        let nuevoElapsed = (partido.elapsed_time || 0) + transcurridos;
                        updates.push('elapsed_time = ?');
                        params.push(nuevoElapsed);
                        updates.push('start_time = NULL');
                    }
                    if (data.estado === 'Acabado' && partido.start_time) {
                        let start = Math.floor(new Date(partido.start_time).getTime() / 1000);
                        let transcurridos = now - start;
                        let nuevoElapsed = (partido.elapsed_time || 0) + transcurridos;
                        updates.push('elapsed_time = ?');
                        params.push(nuevoElapsed);
                        updates.push('start_time = NULL');
                    }
                    if (data.estado === 'En espera') {
                        updates.push('start_time = NULL');
                        updates.push('elapsed_time = 0');
                    }
                }
                if (data.jugadores1 !== undefined) {
                    updates.push('jugadores1 = ?');
                    params.push(data.jugadores1);
                }
                if (data.jugadores2 !== undefined) {
                    updates.push('jugadores2 = ?');
                    params.push(data.jugadores2);
                }
                if (data.jugadores1 !== undefined || data.jugadores2 !== undefined) {
                    const jugadores1 = data.jugadores1 !== undefined ? data.jugadores1 : '';
                    const jugadores2 = data.jugadores2 !== undefined ? data.jugadores2 : '';
                    const jugadores = `${jugadores1}|${jugadores2}`;
                    updates.push('jugadores = ?');
                    params.push(jugadores);
                }
                if (data.sanciones !== undefined) {
                    updates.push('sanciones = ?');
                    params.push(data.sanciones);
                }
                if (data.observaciones !== undefined) {
                    updates.push('observaciones = ?');
                    params.push(data.observaciones);
                }
                if (data.puntaje1 === 'sumar') {
                    updates.push('puntaje1 = puntaje1 + 1');
                } else if (data.puntaje1 === 'restar') {
                    updates.push('puntaje1 = MAX(puntaje1 - 1, 0)');
                } else if (typeof data.puntaje1 === 'number') {
                    updates.push('puntaje1 = ?');
                    params.push(Math.max(0, data.puntaje1));
                }
                if (data.puntaje2 === 'sumar') {
                    updates.push('puntaje2 = puntaje2 + 1');
                } else if (data.puntaje2 === 'restar') {
                    updates.push('puntaje2 = MAX(puntaje2 - 1, 0)');
                } else if (typeof data.puntaje2 === 'number') {
                    updates.push('puntaje2 = ?');
                    params.push(Math.max(0, data.puntaje2));
                }
                if (data.minuto !== undefined && partido.estado !== 'Jugando') {
                    if (data.minuto === 'sumar') {
                        updates.push('minuto = minuto + 1');
                    } else if (data.minuto === 'restar') {
                        updates.push('minuto = MAX(minuto - 1, 0)');
                    } else if (typeof data.minuto === 'number') {
                        updates.push('minuto = ?');
                        params.push(Math.max(0, data.minuto));
                    }
                }
                if (updates.length === 0) {
                    console.log('ℹ️ No hay actualizaciones para realizar');
                    return;
                }
                query += updates.join(', ') + ' WHERE id = ?';
                params.push(data.id);
                const stmt = db.prepare(query);
                stmt.run(params, function(err2) {
                    if (err2) {
                        console.error('❌ Error actualizando partido:', err2);
                        socket.emit('error', { message: 'Error actualizando partido' });
                    } else {
                        console.log(`✅ Partido ${data.id} actualizado correctamente`);
                        emitPartidosUpdate();
                    }
                });
                stmt.finalize();
            });
        });
    });

    socket.on('crear_partido', (data) => {
        requireAdminToken(() => {
            // ...código original de crear_partido aquí...
            console.log('➕ Intentando crear partido:', data);
            if (!data.titulo || !data.equipo1 || !data.equipo2) {
                socket.emit('error', { message: 'Título y equipos requeridos' });
                return;
            }
            if (data.equipo1 === data.equipo2) {
                socket.emit('error', { message: 'Los equipos deben ser diferentes' });
                return;
            }
            const stmt = db.prepare(`INSERT INTO partidos (titulo, equipo1, equipo2, estado, jugadores1, jugadores2, jugadores) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            stmt.run([
                data.titulo ? data.titulo.trim() : '',
                data.equipo1 ? data.equipo1.trim() : '',
                data.equipo2 ? data.equipo2.trim() : '',
                data.estado || 'En espera',
                '', // jugadores1
                '', // jugadores2
                ''  // jugadores
            ], function(err) {
                if (err) {
                    socket.emit('error', { message: 'Error al crear partido' });
                } else {
                    setTimeout(() => {
                        emitPartidosUpdate();
                    }, 100);
                    socket.emit('partido_creado', { id: this.lastID });
                }
            });
            stmt.finalize();
        });
    });

    socket.on('eliminar_partido', (id) => {
        requireAdminToken(() => {
            if (!id) {
                console.error('❌ ID de partido no proporcionado');
                return;
            }
            const stmt = db.prepare("DELETE FROM partidos WHERE id = ?");
            stmt.run([id], function(err) {
                if (err) {
                    console.error('❌ Error eliminando partido:', err);
                    socket.emit('error', { message: 'Error eliminando partido' });
                } else {
                    emitPartidosUpdate();
                }
            });
            stmt.finalize();
        });
    });


    // Permitir comentarios públicos
    socket.on('agregar_comentario', (texto) => {
        console.log(`[SOCKET] agregar_comentario recibido:`, texto);
        if (!texto || typeof texto !== 'string' || texto.trim().length === 0) {
            console.warn('[SOCKET] Comentario vacío, no se guarda');
            socket.emit('error', { message: 'El comentario no puede estar vacío' });
            return;
        }
        if (texto.length > 300) {
            console.warn('[SOCKET] Comentario demasiado largo, no se guarda');
            socket.emit('error', { message: 'El comentario es demasiado largo' });
            return;
        }
        const stmt = db.prepare('INSERT INTO comentarios (texto) VALUES (?)');
        stmt.run([texto.trim()], function(err) {
            if (err) {
                console.error('❌ Error guardando comentario en DB:', err);
                socket.emit('error', { message: 'Error guardando comentario' });
            } else {
                console.log(`✅ Comentario guardado en DB con id ${this.lastID}`);
                emitComentariosUpdate();
            }
        });
        stmt.finalize();
    });

    // Eliminar fixture
    socket.on('eliminar_fixture', (id) => {
        requireAdminToken(() => {
            if (!id) return;
            db.get('SELECT imagen FROM fixtures WHERE id = ?', [id], (err, row) => {
                if (err || !row) {
                    console.error('❌ Error obteniendo fixture para borrar:', err);
                    socket.emit('error', { message: 'Error eliminando fixture' });
                    return;
                }
                const filePath = path.join(__dirname, 'uploads', row.imagen);
                db.run('DELETE FROM fixtures WHERE id = ?', [id], (err2) => {
                    if (err2) {
                        console.error('❌ Error eliminando fixture:', err2);
                        socket.emit('error', { message: 'Error eliminando fixture' });
                    } else {
                        fs.unlink(filePath, (err3) => {
                            if (err3 && err3.code !== 'ENOENT') {
                                console.error('❌ Error borrando archivo de fixture:', err3);
                            }
                        });
                        emitFixturesUpdate();
                    }
                });
            });
        });
    });

    // Eliminar comentario
    socket.on('eliminar_comentario', (id) => {
        requireAdminToken(() => {
            if (!id) return;
            const stmt = db.prepare("DELETE FROM comentarios WHERE id = ?");
            stmt.run([id], function(err) {
                if (err) {
                    console.error('❌ Error eliminando comentario:', err);
                    socket.emit('error', { message: 'Error eliminando comentario' });
                } else {
                    emitComentariosUpdate();
                }
            });
            stmt.finalize();
        });
    });

    socket.on('disconnect', (reason) => {
        console.log('👋 Usuario desconectado:', socket.id, '- Razón:', reason);
    });

    socket.on('error', (err) => {
        console.error('❌ Error en socket:', socket.id, err);
    });
});

// API REST endpoints
// Endpoint temporal de depuración para ver comentarios directamente

// Endpoint temporal de depuración para ver comentarios directamente (debe ir antes del 404)

app.get('/api/partidos', (req, res) => {
    getPartidosConTiempo().then(partidos => {
        res.json({ success: true, data: partidos });
    }).catch(err => {
        console.error('❌ Error API partidos:', err);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    });
});

app.get('/api/comentarios', authenticateAdmin, (req, res) => {
    getComentarios().then(comentarios => {
        res.json({ success: true, data: comentarios });
    }).catch(err => {
        console.error('❌ Error API comentarios:', err);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    });
});

app.get('/api/fixtures', (req, res) => {
    getFixtures().then(fixtures => {
        res.json({ success: true, data: fixtures });
    }).catch(err => {
        console.error('❌ Error API fixtures:', err);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    });
});

// Manejo de errores
app.use((err, req, res, next) => {
    console.error('❌ Error de aplicación:', err);
    res.status(500).json({ 
        success: false,
        error: 'Error interno del servidor',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Algo salió mal'
    });
});

app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        error: 'Ruta no encontrada',
        path: req.originalUrl 
    });
});

// Cierre graceful
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

function gracefulShutdown() {
    console.log('\n🔄 Iniciando cierre graceful del servidor...');
    server.close(() => {
        console.log('✅ Servidor HTTP cerrado');
        db.close((err) => {
            if (err) console.error('❌ Error cerrando base de datos:', err);
            else console.log('✅ Base de datos cerrada');
            console.log('👋 Servidor completamente cerrado');
            process.exit(0);
        });
    });
    setTimeout(() => {
        console.error('⚠️ Forzando cierre del servidor...');
        process.exit(1);
    }, 10000);
}

process.on('uncaughtException', (err) => {
    console.error('❌ Error no capturado:', err);
    gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rechazada no manejada en:', promise, 'razón:', reason);
    gracefulShutdown();
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log('🚀 ========================================');
    console.log('🏆 INTERCODIGOS EPIIS - Servidor Iniciado');
    console.log('🚀 ========================================');
    console.log(`🌐 Servidor disponible en: http://localhost:${PORT}`);
    console.log(`👥 Panel público: http://localhost:${PORT}`);
    console.log(`🔧 Panel admin: http://localhost:${PORT}/admin`);
    console.log('🔑 Credenciales admin: admin / intercodigos123');
    console.log('🚀 ========================================');
});

module.exports = { app, server, db };