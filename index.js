require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Profast server is cooking");
});

app.listen(port, () => {
  console.log(`Profast server running on port ${port}`);
});
