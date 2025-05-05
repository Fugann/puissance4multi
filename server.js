const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
// Configuration CORS améliorée pour Express
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

// Route par défaut
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Serveur Puissance 4</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
          }
          .container {
            background-color: #f9f9f9;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          h1 {
            color: #333;
          }
          code {
            background-color: #f5f5f5;
            padding: 2px 4px;
            border-radius: 4px;
            font-family: monospace;
          }
          .status {
            color: green;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Serveur Puissance 4</h1>
          <p class="status">Statut : En ligne ✅</p>
          <p>Ce serveur gère les connexions Socket.io pour le jeu Puissance 4.</p>
          <p>Pour jouer, accédez à l'application client React.</p>
          <p>Statut du serveur Socket.io : <code>En écoute sur le port ${PORT}</code></p>
          <p>Pour utiliser ce serveur, vous devez y accéder via une application cliente configurée pour utiliser l'URL <code>http://localhost:${PORT}</code></p>
        </div>
      </body>
    </html>
  `);
});

const server = http.createServer(app);
// Configuration CORS améliorée pour Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type"]
  },
  transports: ['polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  debug: true
});

// Structure pour stocker les informations des salles
const rooms = new Map();

// Gestion des connexions Socket.io
io.on('connection', (socket) => {
  console.log(`Utilisateur connecté: ${socket.id}`);

  // Création d'une nouvelle salle
  socket.on('create_room', () => {
    const roomId = generateRoomId();
    rooms.set(roomId, { 
      players: [{ id: socket.id, color: 'red' }],
      board: Array(6).fill(null).map(() => Array(7).fill(null)),
      currentPlayer: 'red',
      winner: null
    });
    
    socket.join(roomId);
    socket.emit('room_created', { roomId, playerColor: 'red' });
    console.log(`Salle créée: ${roomId} par ${socket.id}`);
  });

  // Rejoindre une salle existante
  socket.on('join_room', (roomId) => {
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      
      // Vérifier si la salle est pleine
      if (room.players.length < 2) {
        room.players.push({ id: socket.id, color: 'yellow' });
        socket.join(roomId);
        socket.emit('room_joined', { roomId, playerColor: 'yellow', board: room.board, currentPlayer: room.currentPlayer });
        io.to(roomId).emit('game_start', { board: room.board, currentPlayer: room.currentPlayer });
        console.log(`${socket.id} a rejoint la salle: ${roomId}`);
      } else {
        socket.emit('error', { message: "La salle est pleine." });
      }
    } else {
      socket.emit('error', { message: "Salle introuvable." });
    }
  });

  // Jouer un coup
  socket.on('play_move', ({ roomId, column }) => {
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      
      // Vérifier si c'est le tour du joueur
      const player = room.players.find(p => p.id === socket.id);
      if (player && player.color === room.currentPlayer && !room.winner) {
        // Trouver la ligne disponible
        for (let row = 5; row >= 0; row--) {
          if (room.board[row][column] === null) {
            room.board[row][column] = player.color;
            
            // Vérifier s'il y a un gagnant
            const isWinner = checkWinner(room.board, row, column, player.color);
            if (isWinner) {
              room.winner = player.color;
              io.to(roomId).emit('game_over', { winner: player.color, board: room.board });
            } else {
              // Changer de joueur
              room.currentPlayer = room.currentPlayer === 'red' ? 'yellow' : 'red';
              io.to(roomId).emit('move_played', { board: room.board, currentPlayer: room.currentPlayer });
            }
            break;
          }
        }
      }
    }
  });

  // Rejouer une partie
  socket.on('restart_game', (roomId) => {
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.board = Array(6).fill(null).map(() => Array(7).fill(null));
      room.currentPlayer = 'red';
      room.winner = null;
      io.to(roomId).emit('game_restart', { board: room.board, currentPlayer: 'red' });
    }
  });

  // Déconnexion
  socket.on('disconnect', () => {
    console.log(`Utilisateur déconnecté: ${socket.id}`);
    
    // Nettoyer les salles où le joueur était présent
    rooms.forEach((room, roomId) => {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        
        // Si la salle est vide, la supprimer
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          // Informer l'autre joueur
          io.to(roomId).emit('player_disconnected');
        }
      }
    });
  });
});

// Fonction pour vérifier s'il y a un gagnant
function checkWinner(board, row, col, player) {
  const directions = [
    [0, 1],   // horizontal
    [1, 0],   // vertical
    [1, 1],   // diagonal /
    [1, -1],  // diagonal \
  ];

  return directions.some(([dx, dy]) => {
    let count = 1;
    // Check forward
    for (let i = 1; i < 4; i++) {
      const newRow = row + dx * i;
      const newCol = col + dy * i;
      if (
        newRow >= 0 && newRow < 6 &&
        newCol >= 0 && newCol < 7 &&
        board[newRow][newCol] === player
      ) {
        count++;
      } else {
        break;
      }
    }
    // Check backward
    for (let i = 1; i < 4; i++) {
      const newRow = row - dx * i;
      const newCol = col - dy * i;
      if (
        newRow >= 0 && newRow < 6 &&
        newCol >= 0 && newCol < 7 &&
        board[newRow][newCol] === player
      ) {
        count++;
      } else {
        break;
      }
    }
    return count >= 4;
  });
}

// Générer un ID de salle aléatoire
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Port d'écoute
const PORT = process.env.PORT || 3008;
server.listen(PORT, () => {
  console.log(`Serveur en écoute sur le port ${PORT}`);
}); 