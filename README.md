# API de Tareas

API RESTful para gestionar tareas, hecha con **Node.js** y **Express**. Las tareas se guardan en
un archivo `tareas.json` usando `fs.promises`, y las rutas están protegidas con **JWT**.

> Actividad 3 — Desarrollo Full Stack, Universidad Tecmilenio. Autor: Gerardo Olivares Mijares.

## Tecnologías

- **express**: servidor y rutas
- **body-parser**: lee el cuerpo JSON de las peticiones
- **bcryptjs**: encripta las contraseñas
- **jsonwebtoken**: genera y verifica los tokens de sesión
- **fs.promises** (módulo nativo de Node.js): lectura y escritura asíncrona de archivos

## Instalación y uso

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # con recarga automática (nodemon)
npm run debug      # node --inspect, para depurar con Chrome DevTools
```

Usuario de prueba incluido: `gerardo@ejemplo.com` / `Tareas2026`

## Estructura

```
api-tareas/
├── server.js                           # servidor, rutas, autenticación y manejo de errores
├── tareas.json                         # tareas almacenadas por la API
├── usuarios.json                       # usuarios registrados (contraseñas cifradas)
├── api-tareas.postman_collection.json  # colección para probar en Postman
├── peticiones.http                     # peticiones para la extensión REST Client de VS Code
└── package.json
```

## Endpoints

| Método | Ruta          | Protegida | Descripción                                   |
|--------|---------------|:---------:|-----------------------------------------------|
| POST   | `/register`   | No        | Registra un usuario (nombre, email, password) |
| POST   | `/login`      | No        | Inicia sesión y devuelve un token JWT         |
| GET    | `/tareas`     | Sí        | Devuelve todas las tareas del usuario         |
| GET    | `/tareas/:id` | Sí        | Devuelve una tarea                            |
| POST   | `/tareas`     | Sí        | Crea una tarea (titulo y descripcion)         |
| PUT    | `/tareas/:id` | Sí        | Actualiza titulo, descripcion o completada    |
| DELETE | `/tareas/:id` | Sí        | Elimina una tarea                             |

Las rutas protegidas requieren el encabezado `Authorization: Bearer <token>`.

### Códigos de respuesta

| Código | Significado                                         |
|--------|-----------------------------------------------------|
| 200    | Operación correcta                                  |
| 201    | Recurso creado                                      |
| 400    | Datos inválidos o JSON mal formado                  |
| 401    | Falta el token o las credenciales son incorrectas   |
| 403    | Token inválido o expirado                           |
| 404    | La tarea o la ruta no existe                        |
| 409    | El correo ya está registrado                        |
| 500    | Error interno del servidor                          |

## Probar la API

- **Postman:** importa `api-tareas.postman_collection.json`. Ejecuta primero *Login*; el token
  se guarda automáticamente para las demás peticiones.
- **VS Code:** abre `peticiones.http` con la extensión REST Client y presiona *Send Request*.
