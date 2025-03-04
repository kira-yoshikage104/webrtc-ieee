import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuid } from "uuid";

const wss = new WebSocketServer({ port: 8080 });

const userIdToWebSocket = new Map();
const webSocketToUserId = new Map();
const rooms = new Map(); //hostId -> {roomName, genre, isPublic, members: []}
const memberIdToRooms = new Map();

const addUser = (socket) => {
  const userId = uuid();
  userIdToWebSocket.set(userId, socket);
  webSocketToUserId.set(socket, userId);
  socket.send(JSON.stringify({ type: "userId", userId }));
  console.log(`new user : ${userId}`);
};

const removeUser = (socket) => {
  const userId = webSocketToUserId.get(socket);
  if (rooms.has(userId)) {
    const members = rooms.get(userId).members;
    members.map((memberId) => {
      const memberSock = userIdToWebSocket.get(memberId);
      memberSock?.send(JSON.stringify({ type: "disconnected" }));
    });
    userIdToWebSocket.delete(userId);
    webSocketToUserId.delete(socket);
    rooms.delete(userId); //update remove member from array
    console.log(`host ${userId} disconnected`);
  } else if (userId) {
    userIdToWebSocket.delete(userId);
    webSocketToUserId.delete(socket);
    console.log(`member ${userId} disconnected`);

    const host = memberIdToRooms.get(userId);
    const room = rooms.get(host);
    if (room) {
      room.members = room.members.filter((memberId) => memberId !== userId);
      rooms.set(host, room);
    }
    const hostSocket = userIdToWebSocket.get(host);

    hostSocket?.send(
      JSON.stringify({ type: "disconnected", memberId: userId })
    );
  }
};

const createRoom = (hostSocket, roomName, genre, isPublic) => {
  const hostId = webSocketToUserId.get(hostSocket);
  rooms.set(hostId, { roomName, genre, isPublic, members: [] });
  console.log(rooms);
  return hostId;
};

const joinRoom = (memberSocket, hostId) => {
  const memberId = webSocketToUserId.get(memberSocket);
  if (!rooms.has(hostId)) {
    return memberSocket.send(JSON.stringify({ error: "invalid id" }));
  }
  rooms.get(hostId).members.push(memberId);
  memberIdToRooms.set(memberId, hostId);
  console.log(`member ${memberId} joined room ${hostId}`);
};

const sendAnswer = (hostSocket, message) => {
  // message = {type="create-answer", answer}
  if (!message.answer) {
    return hostSocket.send(
      JSON.stringify({ error: "must include answer and memberId" })
    );
  }
  const hostId = webSocketToUserId.get(hostSocket);
  const memberSocket = userIdToWebSocket.get(message.memberId);
  memberSocket.send(
    JSON.stringify({ type: "create-answer", answer: message.answer })
  );
  console.log(
    `answer ${message.answer} sent from ${hostId} to ${message.memberId}`
  );
};

const exchangeCandidate = (socket, message) => {
  if (!message.targetId) {
    return socket.send(JSON.stringify({ error: "must include target id" }));
  }
  const endUserSocket = userIdToWebSocket.get(message.targetId);
  if (!endUserSocket) {
    return socket.send(JSON.stringify({ error: "invalid target id" }));
  }
  if (!message.candidate) {
    return socket.send(JSON.stringify({ error: "must include candidates" }));
  }
  const senderId = webSocketToUserId.get(socket);
  endUserSocket.send(
    JSON.stringify({
      type: "ice-candidate",
      candidate: message.candidate,
      senderId,
    })
  );
};

wss.on("connection", (ws) => {
  addUser(ws);

  ws.on("close", () => {
    removeUser(ws);
  });

  ws.on("error", (err) => {
    console.error("websocket error : ", err);
    removeUser(ws);
  });

  ws.on("message", (data) => {
    const message = JSON.parse(data);
    if (message.type === "create-room") {
      const hostId = createRoom(
        ws,
        message.roomName,
        message.genre,
        message.isPublic
      );
      ws.send(JSON.stringify({ type: "host-id", hostId }));
      console.log(`user created room ${hostId}`);
    } else if (message.type === "join-room") {
      const hostId = message.hostId;
      if (!hostId) {
        return ws.send(
          JSON.stringify({ error: "message should include hostId" })
        );
      }
      joinRoom(ws, hostId);
      const hostSocket = userIdToWebSocket.get(hostId);
      if (!hostSocket) {
        return ws.send(JSON.stringify({ error: "invalid room" }));
      }
      const memberId = webSocketToUserId.get(ws);
      if (!message.offer) {
        return ws.send(JSON.stringify({ error: "must send offer" }));
      }
      hostSocket.send(
        JSON.stringify({ type: "new-member", memberId, offer: message.offer })
      );
      console.log(`offer ${message.offer} sent from ${memberId} to ${hostId}`);
    } else if (message.type === "create-answer") {
      sendAnswer(ws, message);
    } else if (message.type === "ice-candidate") {
      exchangeCandidate(ws, message);
    } else if (message.type === "public-rooms") {
      const obj = Object.fromEntries(rooms);
      ws.send(JSON.stringify({ type: "public-rooms", rooms: obj }));
    } else {
      ws.send(JSON.stringify({ error: "invalid message type" }));
    }
  });
});
