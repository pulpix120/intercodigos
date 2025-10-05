// Script para reparar la columna jugadores en la base de datos
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('intercodigos.db');


db.serialize(() => {
  db.all("SELECT id, jugadores, jugadores1, jugadores2 FROM partidos", (err, rows) => {
    if (err) {
      console.error('Error leyendo partidos:', err);
      db.close();
      return;
    }
    let pendientes = 0;
    let total = 0;
    rows.forEach(row => {
      let { id, jugadores, jugadores1, jugadores2 } = row;
      let nuevoJugadores = '';
      if (jugadores && jugadores.includes('|')) return;
      if (jugadores && jugadores.includes('/')) {
        nuevoJugadores = jugadores.replace(/\s*\/\s*/g, '|');
      } else {
        nuevoJugadores = (jugadores1 || '') + '|' + (jugadores2 || '');
      }
      pendientes++;
      total++;
      db.run("UPDATE partidos SET jugadores = ? WHERE id = ?", [nuevoJugadores, id], (err2) => {
        if (err2) {
          console.error(`Error actualizando partido ${id}:`, err2);
        } else {
          console.log(`Partido ${id} actualizado: '${jugadores}' => '${nuevoJugadores}'`);
        }
        pendientes--;
        if (pendientes === 0) {
          db.close();
          console.log('✔️ Reparación finalizada.');
        }
      });
    });
    if (total === 0) {
      db.close();
      console.log('No hay registros para reparar.');
    }
  });
});