const express = require('express');
const http= require('http');
const { Server } = require('socket.io');

const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();

const server = http.createServer(app);
const io = new Server(server,{
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type'],
        credentials: true
    }
});
const port = 3000;
const users = {};
app.use(express.static(__dirname));

function broadcastUserList(){
    io.emit('user list',Object.keys(users));
}
io.on('connection', (socket) => {
    socket.on('register',(username)=>{
        users[username]=socket.id;
        console.log(`${username} registered with id ${socket.id}`);
        broadcastUserList();
    });
    
    socket.on('disconnect',()=>{
        for(const [name,id] of Object.entries(users)){
            if(id==socket.id){
                delete users[name];
                break;
            }
        }
        broadcastUserList();
    });
    socket.on('private message',(msgObj)=>{
        const targetSocketId = users[msgObj.to];
        if(targetSocketId){
            io.to(targetSocketId).emit('private message',msgObj);
            socket.emit('private message',msgObj);
        }
    });
    console.log(`A user connected`);
    socket.on('disconnect', () => {
        console.log(`A user disconnected`);
    });
    socket.on('Chat message', (msg) => {
        io.emit('Chat message', msg);
    });
});
server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});