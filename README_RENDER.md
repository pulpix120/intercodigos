Guía de despliegue en Render.com para intercodigos-web

Resumen
-------
Este repositorio es una aplicación Node.js + frontend estático (carpeta `public/`) que usa:
- Express + Socket.IO
- SQLite para almacenamiento local (archivo `intercodigos.db`)
- Subida de imágenes con Multer (guardadas en `/uploads`)
- JWT para autenticación administrativa

Preparación para Render
-----------------------
Render puede ejecutar aplicaciones Node.js y también servir sitios estáticos. Aquí asumimos que desplegarás la aplicación Node.js (Web Service) para que tanto la API como los sockets funcionen.

Pasos rápidos
-------------
1. Asegúrate de que `package.json` contiene un script `start` que ejecute `node server.js` (ya añadido).
2. Subir el repositorio a GitHub (o GitLab/Bitbucket) si no está ya.
3. Crear un nuevo Web Service en Render:
   - Connect a tu repositorio.
   - Selecciona el branch que quieres desplegar.
   - Build command: deja vacío (no es necesario) o `npm install` si quieres.
   - Start command: `npm start`.
   - Environment: `Node` / versión compatible.
4. Variables de entorno importantes:
   - `JWT_SECRET`: cadena secreta para generar tokens JWT (cambia la que viene por defecto).
   - `CLIENT_URL` (opcional): URL pública del frontend para CORS si lo necesitas.
   - `PORT` no es necesario configurar: Render provee `PORT` automáticamente.

Persistencia y SQLite
---------------------
- SQLite escribe un archivo `intercodigos.db` en el filesystem. En Render, el filesystem es efímero: cualquier archivo creado en ejecución puede perderse cuando la instancia se reinicia o escala.
- Recomendaciones:
  - Para persistencia real, migra a una base de datos gestionada (Postgres, MySQL) y actualiza `server.js`.
  - Si necesitas conservar `uploads/` y `intercodigos.db`, usa:
    - Un servicio de almacenamiento (S3, DigitalOcean Spaces) para subir las imágenes.
    - Un servicio de base de datos gestionada.
  - Alternativa temporal: montar un servicio de Filesystem persistente fuera de Render (no recomendado).

Socket.IO y CORS
----------------
- `server.js` ya configura Socket.IO con CORS amplio por defecto (origin: "*") y lee `CLIENT_URL` si la configuras.
- En producción conviene restringir `CLIENT_URL` al dominio de tu frontend para seguridad.

Archivos y estructura
---------------------
- `server.js` - Servidor Express + Socket.IO (ya existe).
- `public/` - Carpeta con `index.html`, `admin.html`, assets y JS.
- `uploads/` - Imágenes subidas (no persistente en Render).
- `intercodigos.db` - Archivo SQLite (no persistente en Render).

Instrucciones detalladas en Render
----------------------------------
1. Crear cuenta en https://render.com y conectar tu repositorio.
2. Entra a "New" → "Web Service".
3. Rellena:
   - Name: intercodigos-web
   - Region: el que prefieras
   - Branch: main (o el que uses)
   - Build Command: (opcional) `npm ci` o `npm install`
   - Start Command: `npm start`
4. Environment: selecciona Node y la versión (por ejemplo, Node 18 o 20).
5. En "Environment variables" agrega:
   - `JWT_SECRET` = (valor seguro)
   - `CLIENT_URL` = https://<tu-dominio> (opcional)
6. Despliega y monitorea logs.

Notas finales
-------------
- Si quieres una configuración estática (sin Node.js), puedo generar `static.json` y mover los archivos a `public/`. Pero tu proyecto actual contiene `server.js`, sockets y SQLite, por lo que la ruta correcta es desplegar como Web Service Node.js.
- Puedo ayudarte a:
  - Crear una versión que use Postgres y actualizar `server.js` y queries.
  - Añadir integración con S3 para `uploads/`.
  - Añadir un `Dockerfile` y desplegar como servicio Docker.

Soporte opcional para persistencia de uploads en S3
-------------------------------------------------
He añadido lógica opcional en `server.js` para subir fixtures a S3 si configuras las siguientes variables de entorno en Render:

- `AWS_REGION` (ej: us-east-1)
- `AWS_BUCKET` (nombre del bucket)
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Comportamiento:
- Si estas variables están presentes y la dependencia `@aws-sdk/client-s3` está instalada, al subir un fixture el servidor subirá el archivo al bucket bajo la llave `fixtures/<filename>` y responderá con `imagen_url` apuntando al objeto S3.
- Si S3 no está configurado, el servidor seguirá guardando el archivo en `/uploads/` y usando esa ruta.

Pasos para activar S3 en Render:
1. Crea un bucket en AWS S3 (ej: `mi-bucket-intercodigos`).
2. Crea un IAM user con permisos `s3:PutObject` y `s3:GetObject` para el bucket.
3. En Render, en la configuración del servicio, añade las variables de entorno listadas arriba con los valores correspondientes.
4. Ejecuta en la raíz del proyecto:
   npm install
5. Reinicia el servicio en Render para recoger las variables.

Nota: incluso con S3 los metadatos y referencias a fixtures se guardan en SQLite por ahora; para producción robusta recomendamos migrar a una base de datos gestionada (Postgres) y actualizar las consultas.

Si quieres, aplico los cambios automáticos ahora: asegurar `package.json` (ya hecho), añadir un `Procfile` o `render.yaml`, y crear `README_RENDER.md` (este archivo). ¿Quieres que genere un `render.yaml` para que la app pueda desplegarse automáticamente con la configuración por defecto?