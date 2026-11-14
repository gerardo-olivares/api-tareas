/* =============================================================
   API de Tareas — server.js
   Desarrollo Full Stack · Actividad 3
   Autor: Gerardo Olivares Mijares

   Contenido:
     1. Configuración del servidor (Express, body-parser, puerto 3000)
     2. Utilidades de errores (ApiError, asyncHandler)
     3. Manejo de datos con fs.promises (tareas.json y usuarios.json)
     4. Autenticación: POST /register y POST /login (bcryptjs + JWT)
     5. Middleware de autenticación (protege /tareas)
     6. Rutas CRUD: GET, POST, PUT, DELETE /tareas
     7. Manejo de errores: 404 y middleware central
   ============================================================= */
'use strict';

const path = require('path');
const fs = require('fs').promises;            // versión con promesas: no bloquea el Event Loop
const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

/* =============================================================
   1. CONFIGURACIÓN
   ============================================================= */
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_solo_para_desarrollo_cambiar_en_produccion';
const JWT_EXPIRES_IN = '1h';
const SALT_ROUNDS = 10;

const ARCHIVO_TAREAS = path.join(__dirname, 'tareas.json');
const ARCHIVO_USUARIOS = path.join(__dirname, 'usuarios.json');

if (!process.env.JWT_SECRET) {
  console.warn('⚠  JWT_SECRET no está definido; se usa una clave de desarrollo.');
}

const app = express();

/* Registro de cada petición (debugging con console.log).
   Va antes de body-parser para que también se registren las peticiones con JSON inválido. */
app.use((req, res, next) => {
  const inicio = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toLocaleTimeString('es-MX')}  ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - inicio} ms)`);
  });
  next();
});

app.use(bodyParser.json({ limit: '10kb' }));   // convierte el cuerpo JSON en req.body

/* =============================================================
   2. UTILIDADES DE ERRORES
   ============================================================= */

/* Error con código HTTP; el middleware de errores lo convierte en respuesta JSON */
class ApiError extends Error {
  constructor(status, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

/* Envuelve funciones async para que sus errores lleguen a next() */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* =============================================================
   3. MANEJO DE DATOS CON fs.promises
   ============================================================= */

/* Lee un archivo JSON y devuelve su contenido; si no existe, devuelve [] */
async function leerJSON(archivo) {
  try {
    const data = await fs.readFile(archivo, 'utf8');
    return data.trim() ? JSON.parse(data) : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];                       // el archivo aún no existe
    if (error instanceof SyntaxError) {
      throw new ApiError(500, `El archivo ${path.basename(archivo)} está dañado (JSON inválido).`);
    }
    throw error;
  }
}

/* Escribe de forma segura: primero a un archivo temporal y luego lo renombra.
   Así, si el proceso se interrumpe a medio guardar, el archivo original no se corrompe. */
async function escribirJSON(archivo, datos) {
  const temporal = `${archivo}.tmp`;
  await fs.writeFile(temporal, JSON.stringify(datos, null, 2), 'utf8');
  await fs.rename(temporal, archivo);
}

/* Cola de escrituras: evita que dos peticiones simultáneas lean y escriban
   el mismo archivo al mismo tiempo y se pierdan cambios. */
let cola = Promise.resolve();
function modificarArchivo(archivo, cambio) {
  const tarea = cola.then(async () => {
    const datos = await leerJSON(archivo);
    const resultado = await cambio(datos);      // la función modifica el arreglo
    await escribirJSON(archivo, datos);
    return resultado;
  });
  cola = tarea.catch(() => {});                // un error no detiene la cola
  return tarea;
}

const obtenerTareas = () => leerJSON(ARCHIVO_TAREAS);
const obtenerUsuarios = () => leerJSON(ARCHIVO_USUARIOS);

/* =============================================================
   VALIDACIONES
   ============================================================= */
const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validarUsuario({ nombre, email, password }, esRegistro) {
  const errores = [];
  if (esRegistro && texto(nombre).length < 2) errores.push({ campo: 'nombre', mensaje: 'El nombre debe tener al menos 2 caracteres.' });
  if (!EMAIL_REGEX.test(texto(email))) errores.push({ campo: 'email', mensaje: 'El correo electrónico no es válido.' });
  if (typeof password !== 'string' || password.length < (esRegistro ? 6 : 1)) {
    errores.push({ campo: 'password', mensaje: esRegistro ? 'La contraseña debe tener al menos 6 caracteres.' : 'La contraseña es obligatoria.' });
  }
  return errores;
}

function validarTarea({ titulo, descripcion, completada }, parcial) {
  const errores = [];
  if (!parcial || titulo !== undefined) {
    if (texto(titulo).length < 3 || texto(titulo).length > 100) errores.push({ campo: 'titulo', mensaje: 'El título es obligatorio (3 a 100 caracteres).' });
  }
  if (!parcial || descripcion !== undefined) {
    if (texto(descripcion).length < 1 || texto(descripcion).length > 500) errores.push({ campo: 'descripcion', mensaje: 'La descripción es obligatoria (máximo 500 caracteres).' });
  }
  if (completada !== undefined && typeof completada !== 'boolean') {
    errores.push({ campo: 'completada', mensaje: 'El campo "completada" debe ser true o false.' });
  }
  return errores;
}

/* =============================================================
   4. AUTENTICACIÓN: REGISTRO E INICIO DE SESIÓN
   ============================================================= */

/* POST /register — crea un usuario con la contraseña encriptada */
app.post('/register', asyncHandler(async (req, res) => {
  const errores = validarUsuario(req.body, true);
  if (errores.length) throw new ApiError(400, 'Datos de registro inválidos.', errores);

  const nombre = texto(req.body.nombre);
  const email = texto(req.body.email).toLowerCase();

  // bcrypt.hash genera una "sal" aleatoria y cifra la contraseña (10 rondas)
  const passwordHash = await bcrypt.hash(req.body.password, SALT_ROUNDS);

  const usuario = await modificarArchivo(ARCHIVO_USUARIOS, (usuarios) => {
    if (usuarios.some((u) => u.email === email)) {
      throw new ApiError(409, 'Ya existe un usuario registrado con ese correo.');
    }
    const nuevo = { id: crypto.randomUUID(), nombre, email, password: passwordHash, creadoEn: new Date().toISOString() };
    usuarios.push(nuevo);
    return nuevo;
  });

  res.status(201).json({
    mensaje: 'Usuario registrado correctamente.',
    usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email },   // nunca se devuelve la contraseña
  });
}));

/* POST /login — verifica credenciales y devuelve un token JWT */
app.post('/login', asyncHandler(async (req, res) => {
  const errores = validarUsuario(req.body, false);
  if (errores.length) throw new ApiError(400, 'Datos de inicio de sesión inválidos.', errores);

  const email = texto(req.body.email).toLowerCase();
  const usuarios = await obtenerUsuarios();
  const usuario = usuarios.find((u) => u.email === email);

  // bcrypt.compare cifra la contraseña recibida y la compara con el hash guardado.
  // Se usa el mismo mensaje en ambos casos para no revelar qué correos existen.
  const valida = usuario && (await bcrypt.compare(req.body.password, usuario.password));
  if (!valida) throw new ApiError(401, 'Correo o contraseña incorrectos.');

  const token = jwt.sign(
    { id: usuario.id, email: usuario.email, nombre: usuario.nombre },   // payload
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({ mensaje: 'Inicio de sesión exitoso.', token, expiraEn: JWT_EXPIRES_IN });
}));

/* =============================================================
   5. MIDDLEWARE DE AUTENTICACIÓN
   ============================================================= */
function autenticarToken(req, res, next) {
  // Formato esperado del encabezado:  Authorization: Bearer <token>
  const encabezado = req.headers['authorization'] || '';
  const [tipo, token] = encabezado.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Acceso denegado: se requiere un token. Inicia sesión en POST /login.'));
  }

  jwt.verify(token, JWT_SECRET, (err, usuario) => {
    if (err) {
      const mensaje = err.name === 'TokenExpiredError' ? 'El token expiró. Inicia sesión de nuevo.' : 'Token inválido.';
      return next(new ApiError(403, mensaje));
    }
    req.usuario = usuario;   // datos del usuario disponibles en las rutas
    next();
  });
}

/* Todas las rutas que empiezan con /tareas requieren token */
app.use('/tareas', autenticarToken);

/* =============================================================
   6. RUTAS CRUD DE TAREAS (protegidas)
   Cada usuario solo ve y modifica sus propias tareas.
   ============================================================= */

/* GET /tareas — devuelve todas las tareas del usuario */
app.get('/tareas', asyncHandler(async (req, res) => {
  const tareas = await obtenerTareas();
  const propias = tareas.filter((t) => t.usuarioId === req.usuario.id);
  res.json({ total: propias.length, tareas: propias });
}));

/* GET /tareas/:id — devuelve una tarea */
app.get('/tareas/:id', asyncHandler(async (req, res) => {
  const tareas = await obtenerTareas();
  const tarea = tareas.find((t) => t.id === req.params.id && t.usuarioId === req.usuario.id);
  if (!tarea) throw new ApiError(404, `No existe una tarea con id ${req.params.id}.`);
  res.json(tarea);
}));

/* POST /tareas — agrega una nueva tarea (título y descripción obligatorios) */
app.post('/tareas', asyncHandler(async (req, res) => {
  const errores = validarTarea(req.body, false);
  if (errores.length) throw new ApiError(400, 'La tarea no es válida.', errores);

  const nuevaTarea = await modificarArchivo(ARCHIVO_TAREAS, (tareas) => {
    const tarea = {
      id: crypto.randomUUID(),
      titulo: texto(req.body.titulo),
      descripcion: texto(req.body.descripcion),
      completada: req.body.completada ?? false,
      usuarioId: req.usuario.id,
      creadaEn: new Date().toISOString(),
      actualizadaEn: new Date().toISOString(),
    };
    tareas.push(tarea);
    return tarea;
  });

  res.status(201).json({ mensaje: 'Tarea creada.', tarea: nuevaTarea });
}));

/* PUT /tareas/:id — actualiza una tarea existente */
app.put('/tareas/:id', asyncHandler(async (req, res) => {
  const { titulo, descripcion, completada } = req.body;
  if (titulo === undefined && descripcion === undefined && completada === undefined) {
    throw new ApiError(400, 'Envía al menos uno de estos campos: titulo, descripcion o completada.');
  }
  const errores = validarTarea(req.body, true);
  if (errores.length) throw new ApiError(400, 'Los datos de la tarea no son válidos.', errores);

  const tareaActualizada = await modificarArchivo(ARCHIVO_TAREAS, (tareas) => {
    const tarea = tareas.find((t) => t.id === req.params.id && t.usuarioId === req.usuario.id);
    if (!tarea) throw new ApiError(404, `No existe una tarea con id ${req.params.id}.`);
    if (titulo !== undefined) tarea.titulo = texto(titulo);
    if (descripcion !== undefined) tarea.descripcion = texto(descripcion);
    if (completada !== undefined) tarea.completada = completada;
    tarea.actualizadaEn = new Date().toISOString();
    return tarea;
  });

  res.json({ mensaje: 'Tarea actualizada.', tarea: tareaActualizada });
}));

/* DELETE /tareas/:id — elimina una tarea */
app.delete('/tareas/:id', asyncHandler(async (req, res) => {
  const eliminada = await modificarArchivo(ARCHIVO_TAREAS, (tareas) => {
    const indice = tareas.findIndex((t) => t.id === req.params.id && t.usuarioId === req.usuario.id);
    if (indice === -1) throw new ApiError(404, `No existe una tarea con id ${req.params.id}.`);
    return tareas.splice(indice, 1)[0];
  });

  res.json({ mensaje: 'Tarea eliminada.', tarea: eliminada });
}));

/* Ruta de inicio con la lista de endpoints */
app.get('/', (req, res) => {
  res.json({
    api: 'API de Tareas',
    endpoints: {
      publicos: ['POST /register', 'POST /login'],
      protegidos: ['GET /tareas', 'GET /tareas/:id', 'POST /tareas', 'PUT /tareas/:id', 'DELETE /tareas/:id'],
    },
  });
});

/* =============================================================
   7. MANEJO DE ERRORES
   ============================================================= */

/* 404: ninguna ruta coincidió */
app.use((req, res, next) => {
  next(new ApiError(404, `La ruta ${req.method} ${req.originalUrl} no existe.`));
});

/* Middleware central de errores (4 parámetros, siempre al final) */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || 500;
  let mensaje = err.message || 'Error interno del servidor.';

  // JSON mal escrito en el cuerpo de la petición (lo detecta body-parser)
  if (err.type === 'entity.parse.failed') {
    status = 400;
    mensaje = 'El cuerpo de la petición no es un JSON válido.';
  }
  if (err.type === 'entity.too.large') {
    status = 413;
    mensaje = 'El cuerpo de la petición es demasiado grande.';
  }

  if (status >= 500) {
    console.error('✖ Error interno:', err.stack);   // detalle completo solo en la consola
    mensaje = err instanceof ApiError ? mensaje : 'Error interno del servidor.';
  }

  res.status(status).json({
    error: { status, mensaje, ...(err.detalles && { detalles: err.detalles }) },
  });
});

/* =============================================================
   INICIO DEL SERVIDOR
   ============================================================= */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✔ Servidor corriendo en el puerto ${PORT}  ->  http://localhost:${PORT}`);
  });
}

module.exports = app;   // permite probar la API sin levantar el puerto
