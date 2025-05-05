import { useState, useEffect } from "react";
import io from "socket.io-client";
import React from "react";

type Player = "red" | "yellow" | null;
type AIDifficulty = "facile" | "normal" | "difficile" | "impossible";
type GameMode = "solo" | "ai" | "online";

// Types pour les événements Socket.io
interface RoomCreatedData {
  roomId: string;
  playerColor: "red" | "yellow";
}

interface RoomJoinedData {
  roomId: string;
  playerColor: "red" | "yellow";
  board: Player[][];
  currentPlayer: "red" | "yellow";
}

interface GameData {
  board: Player[][];
  currentPlayer: "red" | "yellow";
}

interface GameOverData extends GameData {
  winner: "red" | "yellow";
}

interface ErrorData {
  message: string;
}

// Configuration améliorée de Socket.io
const socket = io("http://127.0.0.1:3008", {
  transports: ['polling'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  timeout: 20000,
  forceNew: true
});

function App() {
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [board, setBoard] = useState<Player[][]>(Array(6).fill(null).map(() => Array(7).fill(null)));
  const [currentPlayer, setCurrentPlayer] = useState<"red" | "yellow">("red");
  const [winner, setWinner] = useState<Player>(null);
  const [scores, setScores] = useState({ red: 0, yellow: 0 });
  const [isPlayingAgainstAI, setIsPlayingAgainstAI] = useState(false);
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>("normal");
  
  // État pour le multijoueur
  const [gameMode, setGameMode] = useState<GameMode>("solo");
  const [roomId, setRoomId] = useState<string>("");
  const [playerColor, setPlayerColor] = useState<"red" | "yellow" | null>(null);
  const [roomError, setRoomError] = useState<string>("");
  const [joinRoomId, setJoinRoomId] = useState<string>("");
  const [waitingForPlayer, setWaitingForPlayer] = useState<boolean>(false);
  const [opponentDisconnected, setOpponentDisconnected] = useState<boolean>(false);

  useEffect(() => {
    if (isPlayingAgainstAI && currentPlayer === "yellow" && !winner && gameMode === "ai") {
      const timer = setTimeout(() => {
        makeAIMove();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [currentPlayer, isPlayingAgainstAI, winner, gameMode]);

  // Configuration des événements Socket.io
  useEffect(() => {
    // Création d'une salle
    socket.on('room_created', (data: RoomCreatedData) => {
      setRoomId(data.roomId);
      setPlayerColor(data.playerColor);
      setWaitingForPlayer(true);
      setOpponentDisconnected(false);
    });

    // Rejoindre une salle
    socket.on('room_joined', (data: RoomJoinedData) => {
      setRoomId(data.roomId);
      setPlayerColor(data.playerColor);
      setBoard(data.board);
      setCurrentPlayer(data.currentPlayer);
      setWaitingForPlayer(false);
      setOpponentDisconnected(false);
    });

    // Commencer la partie
    socket.on('game_start', (data: GameData) => {
      setBoard(data.board);
      setCurrentPlayer(data.currentPlayer);
      setWaitingForPlayer(false);
    });

    // Coup joué
    socket.on('move_played', (data: GameData) => {
      setBoard(data.board);
      setCurrentPlayer(data.currentPlayer);
    });

    // Fin de partie
    socket.on('game_over', (data: GameOverData) => {
      setBoard(data.board);
      setWinner(data.winner);
      setScores(prev => ({
        ...prev,
        [data.winner]: prev[data.winner] + 1
      }));
    });

    // Recommencer la partie
    socket.on('game_restart', (data: GameData) => {
      setBoard(data.board);
      setCurrentPlayer(data.currentPlayer);
      setWinner(null);
    });

    // Erreur
    socket.on('error', (data: ErrorData) => {
      setRoomError(data.message);
    });

    // Déconnexion
    socket.on('player_disconnected', () => {
      setOpponentDisconnected(true);
    });

    return () => {
      socket.off('room_created');
      socket.off('room_joined');
      socket.off('game_start');
      socket.off('move_played');
      socket.off('game_over');
      socket.off('game_restart');
      socket.off('error');
      socket.off('player_disconnected');
    };
  }, []);

  const createRoom = () => {
    socket.emit('create_room');
    setGameMode("online");
    setIsGameStarted(true);
  };

  const joinRoom = () => {
    if (joinRoomId.trim()) {
      socket.emit('join_room', joinRoomId.trim());
      setGameMode("online");
      setIsGameStarted(true);
    }
  };

  const playOnlineMove = (colIndex: number) => {
    if (winner || currentPlayer !== playerColor || waitingForPlayer || opponentDisconnected) return;
    socket.emit('play_move', { roomId, column: colIndex });
  };

  const restartOnlineGame = () => {
    socket.emit('restart_game', roomId);
  };

  const getRandomMove = (board: Player[][]): number => {
    const validMoves = getValidMoves(board);
    return validMoves[Math.floor(Math.random() * validMoves.length)];
  };

  const getEasyMove = (board: Player[][]): number => {
    // 70% de chance de faire un coup aléatoire
    if (Math.random() < 0.7) {
      return getRandomMove(board);
    }
    // 30% de chance de faire un coup intelligent
    return getSmartMove(board);
  };

  const getSmartMove = (board: Player[][]): number => {
    // Vérifier d'abord si on peut gagner
    for (const col of getValidMoves(board)) {
      const row = getNextOpenRow(board, col);
      if (row === -1) continue;
      
      const boardCopy = board.map(row => [...row]);
      boardCopy[row][col] = "yellow";
      
      if (checkWinner(boardCopy, row, col, "yellow")) {
        return col;
      }
    }

    // Vérifier si on doit bloquer le joueur
    for (const col of getValidMoves(board)) {
      const row = getNextOpenRow(board, col);
      if (row === -1) continue;
      
      const boardCopy = board.map(row => [...row]);
      boardCopy[row][col] = "red";
      
      if (checkWinner(boardCopy, row, col, "red")) {
        return col;
      }
    }

    // Sinon, faire un coup aléatoire
    return getRandomMove(board);
  };

  const evaluateWindow = (window: Player[], player: Player): number => {
    let score = 0;
    const opponent = player === "red" ? "yellow" : "red";

    if (window.filter(cell => cell === player).length === 4) score += 100;
    else if (window.filter(cell => cell === player).length === 3 && window.filter(cell => cell === null).length === 1) score += 5;
    else if (window.filter(cell => cell === player).length === 2 && window.filter(cell => cell === null).length === 2) score += 2;

    if (window.filter(cell => cell === opponent).length === 3 && window.filter(cell => cell === null).length === 1) score -= 4;

    return score;
  };

  const evaluatePosition = (board: Player[][], player: Player): number => {
    let score = 0;

    // Horizontal
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 4; c++) {
        const window = [board[r][c], board[r][c + 1], board[r][c + 2], board[r][c + 3]];
        score += evaluateWindow(window, player);
      }
    }

    // Vertical
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 7; c++) {
        const window = [board[r][c], board[r + 1][c], board[r + 2][c], board[r + 3][c]];
        score += evaluateWindow(window, player);
      }
    }

    // Diagonal positive
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const window = [board[r][c], board[r + 1][c + 1], board[r + 2][c + 2], board[r + 3][c + 3]];
        score += evaluateWindow(window, player);
      }
    }

    // Diagonal negative
    for (let r = 3; r < 6; r++) {
      for (let c = 0; c < 4; c++) {
        const window = [board[r][c], board[r - 1][c + 1], board[r - 2][c + 2], board[r - 3][c + 3]];
        score += evaluateWindow(window, player);
      }
    }

    return score;
  };

  const isValidMove = (board: Player[][], col: number): boolean => {
    return board[0][col] === null;
  };

  const getValidMoves = (board: Player[][]): number[] => {
    const validMoves: number[] = [];
    for (let col = 0; col < 7; col++) {
      if (isValidMove(board, col)) {
        validMoves.push(col);
      }
    }
    return validMoves;
  };

  const getNextOpenRow = (board: Player[][], col: number): number => {
    for (let r = 5; r >= 0; r--) {
      if (board[r][col] === null) {
        return r;
      }
    }
    return -1;
  };

  const minimax = (board: Player[][], depth: number, alpha: number, beta: number, maximizingPlayer: boolean): [number | null, number] => {
    const validMoves = getValidMoves(board);
    const isTerminal = validMoves.length === 0;

    if (depth === 0 || isTerminal) {
      return [null, evaluatePosition(board, "yellow")];
    }

    if (maximizingPlayer) {
      let value = -Infinity;
      let column = validMoves[0];
      for (const col of validMoves) {
        const row = getNextOpenRow(board, col);
        if (row === -1) continue;
        
        const boardCopy = board.map(row => [...row]);
        boardCopy[row][col] = "yellow";
        
        if (checkWinner(boardCopy, row, col, "yellow")) {
          return [col, 100000000];
        }
        
        const newScore = minimax(boardCopy, depth - 1, alpha, beta, false)[1];
        if (newScore > value) {
          value = newScore;
          column = col;
        }
        alpha = Math.max(alpha, value);
        if (alpha >= beta) break;
      }
      return [column, value];
    } else {
      let value = Infinity;
      let column = validMoves[0];
      for (const col of validMoves) {
        const row = getNextOpenRow(board, col);
        if (row === -1) continue;
        
        const boardCopy = board.map(row => [...row]);
        boardCopy[row][col] = "red";
        
        if (checkWinner(boardCopy, row, col, "red")) {
          return [col, -100000000];
        }
        
        const newScore = minimax(boardCopy, depth - 1, alpha, beta, true)[1];
        if (newScore < value) {
          value = newScore;
          column = col;
        }
        beta = Math.min(beta, value);
        if (alpha >= beta) break;
      }
      return [column, value];
    }
  };

  const makeAIMove = () => {
    if (winner || currentPlayer === "red") return;

    let col: number | null = null;

    switch (aiDifficulty) {
      case "facile":
        col = getEasyMove(board);
        break;
      case "normal":
        col = getSmartMove(board);
        break;
      case "difficile":
        const [difficultCol] = minimax(board, 3, -Infinity, Infinity, true);
        col = difficultCol;
        break;
      case "impossible":
        const [impossibleCol] = minimax(board, 5, -Infinity, Infinity, true);
        col = impossibleCol;
        break;
    }

    if (col !== null) {
      handleColumnClick(col);
    }
  };

  const checkWinner = (board: Player[][], row: number, col: number, player: Player): boolean => {
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
  };

  const handleColumnClick = (colIndex: number) => {
    if (winner) return;

    // Si en mode multijoueur, utiliser la logique en ligne
    if (gameMode === "online") {
      playOnlineMove(colIndex);
      return;
    }

    // Sinon, logique normale ou IA
    for (let row = 5; row >= 0; row--) {
      if (board[row][colIndex] === null) {
        const newBoard = board.map(row => [...row]);
        newBoard[row][colIndex] = currentPlayer;
        setBoard(newBoard);

        if (checkWinner(newBoard, row, colIndex, currentPlayer)) {
          setWinner(currentPlayer);
          setScores(prev => ({
            ...prev,
            [currentPlayer]: prev[currentPlayer] + 1
          }));
        } else {
          setCurrentPlayer(currentPlayer === "red" ? "yellow" : "red");
        }
        break;
      }
    }
  };

  const resetGame = () => {
    if (gameMode === "online") {
      restartOnlineGame();
    } else {
      setBoard(Array(6).fill(null).map(() => Array(7).fill(null)));
      setCurrentPlayer("red");
      setWinner(null);
    }
  };

  const startAIGame = () => {
    setIsGameStarted(true);
    setIsPlayingAgainstAI(true);
    setGameMode("ai");
    resetGame();
  };

  const startLocalGame = () => {
    setIsGameStarted(true);
    setIsPlayingAgainstAI(false);
    setGameMode("solo");
    resetGame();
  };

  if (isGameStarted) {
    return (
      <>
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
          <h1 className="text-2xl font-bold mb-4">Puissance 4</h1>
          
          {gameMode === "online" && (
            <div className="mb-4 text-center">
              {waitingForPlayer ? (
                <div className="bg-yellow-100 p-3 rounded-md border border-yellow-300">
                  <p className="font-bold">En attente d'un autre joueur...</p>
                  <p className="text-sm mt-1">Partagez ce code: <span className="font-mono bg-gray-100 p-1 rounded">{roomId}</span></p>
                </div>
              ) : opponentDisconnected ? (
                <div className="bg-red-100 p-3 rounded-md border border-red-300">
                  <p className="font-bold">Votre adversaire s'est déconnecté.</p>
                </div>
              ) : (
                <div className="bg-blue-100 p-2 rounded-md">
                  Salle: <span className="font-mono">{roomId}</span> • Vous êtes {playerColor === "red" ? "rouge" : "jaune"}
                </div>
              )}
            </div>
          )}
          
          <div className="mb-4 flex gap-8">
            <div className="text-red-500 font-bold">Rouge: {scores.red}</div>
            <div className="text-yellow-500 font-bold">Jaune: {scores.yellow}</div>
          </div>

          <div className="mb-4">
            {winner ? (
              <div className="text-xl font-bold">
                Le joueur {winner === "red" ? "rouge" : "jaune"} a gagné !
              </div>
            ) : waitingForPlayer ? (
              <div className="text-xl">En attente d'un adversaire</div>
            ) : (
              <div className="text-xl">
                Tour du joueur <span className={`font-bold ${currentPlayer === "red" ? "text-red-500" : "text-yellow-500"}`}>
                  {currentPlayer === "red" ? "rouge" : "jaune"}
                </span>
                {gameMode === "online" && currentPlayer !== playerColor && !opponentDisconnected && (
                  <span className="text-sm ml-2">(en attente de l'adversaire)</span>
                )}
              </div>
            )}
          </div>

          <div className="bg-blue-600 p-4 rounded-lg">
            <div className="grid grid-cols-7 gap-2">
              {board.map((row, rowIndex) => (
                row.map((cell, colIndex) => (
                  <div
                    key={`${rowIndex}-${colIndex}`}
                    onClick={() => handleColumnClick(colIndex)}
                    className={`w-12 h-12 rounded-full cursor-pointer transition-colors ${
                      cell === null 
                        ? "bg-white hover:bg-gray-100" 
                        : cell === "red" 
                          ? "bg-red-500" 
                          : "bg-yellow-500"
                    }`}
                  />
                ))
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-4 items-center">
            <div className="flex gap-4">
              <button 
                onClick={resetGame}
                className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors"
              >
                Nouvelle partie
              </button>
              <button 
                onClick={() => {
                  setIsGameStarted(false);
                  setRoomId("");
                  setPlayerColor(null);
                  setWaitingForPlayer(false);
                  setOpponentDisconnected(false);
                  setGameMode("solo");
                }}
                className="bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600 transition-colors"
              >
                Retour au menu
              </button>
            </div>

            {gameMode === "ai" && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setAiDifficulty("facile")}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    aiDifficulty === "facile"
                      ? "bg-green-500 text-white"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  Facile
                </button>
                <button
                  onClick={() => setAiDifficulty("normal")}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    aiDifficulty === "normal"
                      ? "bg-green-500 text-white"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  Normal
                </button>
                <button
                  onClick={() => setAiDifficulty("difficile")}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    aiDifficulty === "difficile"
                      ? "bg-green-500 text-white"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  Difficile
                </button>
                <button
                  onClick={() => setAiDifficulty("impossible")}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    aiDifficulty === "impossible"
                      ? "bg-green-500 text-white"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  Impossible
                </button>
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col items-center justify-center h-screen p-4">
        <h1 className="text-3xl font-bold mb-8">Puissance 4</h1>
        
        <div className="flex flex-col gap-4 w-full max-w-md">
          <button 
            onClick={startLocalGame} 
            className="bg-blue-500 text-white p-3 rounded-md hover:bg-blue-600 transition-colors"
          >
            Jouer en local (2 joueurs)
          </button>
          
          <button 
            onClick={startAIGame} 
            className="bg-green-500 text-white p-3 rounded-md hover:bg-green-600 transition-colors"
          >
            Jouer contre l'IA
          </button>
          
          <div className="border-t border-gray-200 my-4 pt-4">
            <h2 className="text-xl font-bold mb-3">Mode Multijoueur</h2>
            
            <button 
              onClick={createRoom} 
              className="w-full bg-purple-500 text-white p-3 rounded-md hover:bg-purple-600 transition-colors mb-3"
            >
              Créer une partie en ligne
            </button>
            
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Code de la salle"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                className="flex-1 p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button 
                onClick={joinRoom}
                disabled={!joinRoomId.trim()} 
                className={`bg-indigo-500 text-white p-3 rounded-md hover:bg-indigo-600 transition-colors ${!joinRoomId.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Rejoindre
              </button>
            </div>
            
            {roomError && (
              <div className="mt-2 text-red-500 text-sm">{roomError}</div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default App
