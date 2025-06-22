let activeChatUser = null;
const privateMessages = {};
// let username ='';
// while(!username){
//     username = prompt('Please enter your name:');
// }
// document.getElementById('current-user').textContent = `You are: ${username}`;
// const socket=io();
// socket.emit('register', username);

const userList = document.getElementById('user-list');
const form =document.getElementById('chat-form');
const input=document.getElementById('message-input');
const messages =document.getElementById('messages');
const chatUsername = document.getElementById('chat-username');

socket.on('user list', (users) => {
  userList.innerHTML = '';
  users
    .filter(user => user !== username)
    .forEach(user => {
      const li = document.createElement('li');
      li.textContent = user;
      li.style.cursor = 'pointer';
      userList.appendChild(li);
    });
});

userList.addEventListener('click', (e) => {
  if (e.target.tagName === 'LI') {
    activeChatUser = e.target.textContent;
    chatUsername.textContent = activeChatUser;
    displayPrivateChat(activeChatUser);
  }
});

function displayPrivateChat(username) {
  messages.innerHTML = '';
  (privateMessages[username] || []).forEach(msg => {
    const item = document.createElement('li');
    item.className = (msg.from === username) ? 'received' : 'sent';
    item.innerHTML = `<div class="message-bubble">${msg.text}<div class="message-meta">${msg.time}</div></div>`;
    messages.appendChild(item);
  });
}

form.addEventListener('submit', function(e) {
  e.preventDefault();
  if (input.value) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    socket.emit('Chat message', {
      user: username,
      text: input.value,
      time: time
    });
    input.value = '';
  }
});

socket.on('Chat message', function(msgObj) {
  const item = document.createElement('li');
  item.className = (msgObj.user === username) ? 'sent' : 'received';
  item.innerHTML = `
    <div class="message-bubble">
      <strong>${msgObj.user}:</strong> ${msgObj.text}
      <div class="message-meta">${msgObj.time || ''}</div>
    </div>`;
  messages.appendChild(item);
  window.scrollTo(0, document.body.scrollHeight);
});

const privateForm = document.getElementById('private-form');
const privateRecipient = document.getElementById('private-recipient');
const privateInput = document.getElementById('private-message');

privateForm.addEventListener('submit', function(e) {
  e.preventDefault();
  const messageText = privateInput.value.trim();
  if (activeChatUser && messageText) {
    const msgObj = {
      to: activeChatUser,
      from: username,
      text: messageText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    socket.emit('private message', msgObj);
    privateMessages[activeChatUser] = privateMessages[activeChatUser] || [];
    privateMessages[activeChatUser].push(msgObj);
    displayPrivateChat(activeChatUser);
    privateInput.value = '';
  }
});

socket.on('private message', ({ from, text, time }) => {
  privateMessages[from] = privateMessages[from] || [];
  privateMessages[from].push({ from, text, time });
  if (activeChatUser === from) {
    displayPrivateChat(from);
  }
});
