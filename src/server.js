require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { PrismaClient } = require("../generated/prisma");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

const app = express();

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
});

const prisma = new PrismaClient({
  adapter,
});

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "API FinPibble rodando" });
});

app.get("/accounts", async (req, res) => {
  const accounts = await prisma.account.findMany({
    orderBy: {
      id: "desc",
    },
  });

  res.json(accounts);
});

app.post("/accounts", async (req, res) => {
  const { name, type, balance, color, icon } = req.body;

  if (!name || !type) {
    return res.status(400).json({
      message: "Nome e tipo da conta são obrigatórios",
    });
  }

  const account = await prisma.account.create({
    data: {
      name,
      type,
      balance: Number(balance || 0),
      color,
      icon,
    },
  });

  res.status(201).json(account);
});

app.delete("/accounts/:id", async (req, res) => {
  const { id } = req.params;

  await prisma.account.delete({
    where: { id: Number(id) },
  });

  res.json({ message: "Conta removida com sucesso" });
});

app.listen(3333, () => {
  console.log("API rodando em http://localhost:3333");
});