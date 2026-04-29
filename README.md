# CIBC Hangman Party

A dependency-free online Hangman-style party game for up to 300 players in one shared room.

## Run locally

```powershell
node server.js
```

Open `http://localhost:3000`.

## Play

1. Enter a name and press **Join**.
2. The first player to join becomes the **Host**.
3. The host must type a secret word or phrase and press **Start custom round**.
4. Share the hosted URL with other players.
5. Everyone guesses letters on the same board in real time.
6. Each player gets 5 missed tries per round.
7. Correct guesses score 2 points. Solving the word gives an 8 point bonus.
8. The host starts every new round by entering another word.

## Host online on Render

This app uses only Node's built-in modules, so deployment is simple. Render is a good fit because it hosts Node web services and gives you a public HTTPS URL.

1. Put these files in a GitHub repository.
2. Go to Render and choose **New > Web Service**.
3. Connect the GitHub repository.
4. Use these settings:

| Setting | Value |
| --- | --- |
| Language | Node |
| Build command | Leave blank, or use `echo no build needed` |
| Start command | `node server.js` |

5. Deploy. Render will give you a URL like `https://your-game.onrender.com`.
6. Share that URL with players.

The server already listens on `process.env.PORT` and `0.0.0.0`, which hosted Node services require.

## Host online on Railway

1. Put these files in a GitHub repository.
2. Create a Railway project from that repo.
3. Make sure the start command is:

```bash
node server.js
```

4. Railway provides a `PORT` value automatically. This app reads it.
5. Generate or open the public domain for the service, then share it with players.

## Notes

- Player state and scores are stored in memory. They reset when the server restarts.
- The current version is one public room with a 300-player cap.
- The first online player is host. If the host leaves, another online player becomes host.
- Custom phrases keep spaces between words on the puzzle board.
- There are no random words. The host always supplies the word.
- Logging out removes the player from the room and clears their saved join session.
- No database or npm install is required.
