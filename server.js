const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
const server = createServer(app);
const io = new Server(server);

// A helper function to safely handle SQL queries
function cleanseSQL(query, params) {
    if (!query || !Array.isArray(params)) {
        throw new Error("Invalid query or parameters.");
    }

    let index = 0;
    const safeQuery = query.replace(/\?/g, () => {
        if (index >= params.length) {
            throw new Error("Insufficient parameters provided.");
        }

        const value = params[index++];
        if (typeof value === "string") {
            // Escape single quotes in strings
            return `'${value.replace(/'/g, "''")}'`;
        } else if (typeof value === "number" || typeof value === "boolean") {
            return value;
        } else if (value === null) {
            return "NULL";
        } else {
            throw new Error("Unsupported parameter type.");
        }
    });

    if (index !== params.length) {
        throw new Error("Too many parameters provided.");
    }

    return safeQuery;
}

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

  // Keep track of online users in memory
  const onlineUsers = {};

  io.on('connection', (socket) => {
    // Handle incoming chat messages and broadcast to all clients
    socket.on('chat message', (msg) => {
      io.emit('chat message', msg);
    });

    // Handle account creation
    socket.on('createaccount', async (user, pass) => {
      try {
        if (!user || !pass) {
          socket.emit('registrationError', 'Username and password are required.');
          return;
        }

        // Check if username already exists
        const checkQuery = cleanseSQL("SELECT user FROM user_pass WHERE user = ?", [user]);
        const existingUser = await db.get(checkQuery);
        if (existingUser) {
          socket.emit('registrationError', 'Username already taken.');
          return;
        }

        // Insert new user
        const insertQuery = cleanseSQL("INSERT INTO user_pass (user, pass) VALUES (?, ?)", [user, pass]);
        await db.run(insertQuery);
        socket.emit('registrationSuccess', 'Account created successfully. You can now log in.');
      } catch (error) {
        console.error('Error creating account:', error);
        socket.emit('registrationError', 'An error occurred while creating your account.');
      }
    });

    // Handle user login
    socket.on('login', async (user, pass) => {
      try {
        if (!user || !pass) {
          socket.emit('loginError', 'Username and password are required.');
          return;
        }

        const query = cleanseSQL("SELECT user, pass FROM user_pass WHERE user = ? AND pass = ?", [user, pass]);
        const row = await db.get(query);
        if (!row) {
          socket.emit('loginError', 'Invalid username or password.');
          return;
        }

        // Successfully authenticated, store username on socket
        socket.username = user;
        onlineUsers[user] = true;

        // Notify this client of success
        socket.emit('loginSuccess', 'You are now logged in.');

        // Broadcast the updated list of online users to everyone
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
        // Update all clients with new online user list
        io.emit('onlineUsers', Object.keys(onlineUsers));
      }
    });
  });
}

main().catch(err => console.error(err));
