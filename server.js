const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// In-memory room storage
const rooms = {};

// Helper: Generate short Room ID (e.g., "phys-a3f2")
function generateRoomId(prefix = "room") {
  const code = crypto.randomBytes(2).toString("hex");
  const cleanPrefix = prefix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4) || "room";
  return `${cleanPrefix}-${code}`;
}

// API: Create custom room
app.post("/api/rooms/create", (req, res) => {
  const { roomName, focusMins, breakMins } = req.body;
  const roomId = generateRoomId(roomName);

  rooms[roomId] = {
    roomId,
    roomName: roomName || "Learny Focus Room",
    focusDuration: (focusMins || 25) * 60,
    breakDuration: (breakMins || 5) * 60,
    status: "FOCUS",
    endTime: Date.now() + (focusMins || 25) * 60 * 1000,
    users: {}
  };

  res.json({ success: true, roomId, room: rooms[roomId] });
});

// Socket.io Real-time Logic
io.on("connection", (socket) => {
  socket.on("join_room", ({ roomId, userName }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("error_msg", "Room not found!");
      return;
    }

    socket.join(roomId);
    room.users[socket.id] = userName || "Anonymous Student";

    // Sync room state to joining user
    io.to(roomId).emit("room_updated", {
      roomName: room.roomName,
      status: room.status,
      endTime: room.endTime,
      users: Object.values(room.users)
    });
  });

  socket.on("send_message", ({ roomId, text }) => {
    const room = rooms[roomId];
    if (room && room.status === "FOCUS") {
      socket.emit("error_msg", "Chat is locked during Focus sessions!");
      return;
    }
    io.to(roomId).emit("new_message", {
      sender: room.users[socket.id] || "Student",
      text
    });
  });

  socket.on("disconnecting", () => {
    socket.rooms.forEach((roomId) => {
      if (rooms[roomId] && rooms[roomId].users[socket.id]) {
        delete rooms[roomId].users[socket.id];
        io.to(roomId).emit("room_updated", {
          roomName: rooms[roomId].roomName,
          status: rooms[roomId].status,
          endTime: rooms[roomId].endTime,
          users: Object.values(rooms[roomId].users)
        });
      }
    });
  });
});

// Server timer loop to auto-switch between Focus and Break
setInterval(() => {
  const now = Date.now();
  Object.keys(rooms).forEach((roomId) => {
    const room = rooms[roomId];
    if (now >= room.endTime) {
      if (room.status === "FOCUS") {
        room.status = "BREAK";
        room.endTime = now + room.breakDuration * 1000;
      } else {
        room.status = "FOCUS";
        room.endTime = now + room.focusDuration * 1000;
      }
      io.to(roomId).emit("phase_changed", {
        status: room.status,
        endTime: room.endTime
      });
    }
  });
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Study Room running on http://localhost:${PORT}`));
