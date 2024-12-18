const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
const server = createServer(app);
const io = new Server(server);

async function main() {
  // open the database file
  const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_pass (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT UNIQUE,
        pass TEXT
    );
  `);

  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'assets/serverView.html'));
  });

  server.listen(3000, () => {
    console.log('server running at http://localhost:3000');
  });

  const onlineUsers = {};

  io.on('connection', (socket) => {
    // On receiving a chat message, include the username
    socket.on('chat message', (msg) => {
      // Only send the username if the user is logged in
      // If for some reason socket.username is undefined, show 'Anonymous'
      const username = socket.username || 'Anonymous';
      io.emit('chat message', { username, message: msg });
    });

    // Handle account creation safely with parameterized queries
    socket.on('createaccount', async (user, pass) => {
      try {
        if (!user || !pass) {
          socket.emit('registrationError', 'Username and password are required.');
          return;
        }

        // Check if username already exists
        const existingUser = await db.get("SELECT user FROM user_pass WHERE user = ?", [user]);
        if (existingUser) {
          socket.emit('registrationError', 'Username already taken.');
          return;
        }

        // Insert new user
        await db.run("INSERT INTO user_pass (user, pass) VALUES (?, ?)", [user, pass]);
        socket.emit('registrationSuccess', 'Account created successfully. You can now log in.');
      } catch (error) {
        console.error('Error creating account:', error);
        socket.emit('registrationError', 'An error occurred while creating your account.');
      }
    });

    // Handle user login safely with parameterized queries
    socket.on('login', async (user, pass) => {
      try {
        if (!user || !pass) {
          socket.emit('loginError', 'Username and password are required.');
          return;
        }

        const row = await db.get("SELECT user, pass FROM user_pass WHERE user = ? AND pass = ?", [user, pass]);
        if (!row) {
          socket.emit('loginError', 'Invalid username or password.');
          return;
        }

        // Successfully authenticated
        socket.username = user;
        onlineUsers[user] = true;

        socket.emit('loginSuccess', 'You are now logged in.');
        io.emit('onlineUsers', Object.keys(onlineUsers));
      } catch (error) {
        console.error('Error during login:', error);
        socket.emit('loginError', 'An error occurred during login.');
      }
    });

    // Handle user disconnection
    socket.on('disconnect', () => {
      if (socket.username && onlineUsers[socket.username]) {
        delete onlineUsers[socket.username];
        io.emit('onlineUsers', Object.keys(onlineUsers));
      }
    });
  });
}

main().catch(err => console.error(err));