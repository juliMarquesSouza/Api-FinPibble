require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});

const prisma = new PrismaClient({ adapter });

const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "finpibble-dev-secret";



app.use(cors());
app.use(express.json());

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

function createToken(user) {
  return jwt.sign(publicUser(user), JWT_SECRET, { expiresIn: "7d" });
}

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function authRequired(req, res, next) {
  const authorization = req.headers.authorization || "";
  const [, token] = authorization.split(" ");

  if (!token) {
    return res.status(401).json({ message: "Faça login para continuar" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Sessão expirada. Entre novamente." });
  }
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getMonthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);

  return { start, end };
}

function parseTransactionDate(value) {
  if (!value) {
    return new Date();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
}

app.get("/", (req, res) => {
  res.json({ message: "API FinPibble rodando" });
});

app.post("/auth/register", asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Nome, email e senha são obrigatórios" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "A senha deve ter pelo menos 6 caracteres" });
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (existingUser) {
    return res.status(409).json({ message: "Já existe uma conta com este email" });
  }

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: await bcrypt.hash(password, 10),
    },
  });

  res.status(201).json({
    token: createToken(user),
    user: publicUser(user),
  });
}));

app.post("/auth/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email e senha são obrigatórios" });
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user) {
    return res.status(404).json({ message: "Email não cadastrado" });
  }

  if (!(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: "Email ou senha inválidos" });
  }

  res.json({
    token: createToken(user),
    user: publicUser(user),
  });
}));

app.post("/auth/forgot-password", asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Informe seu email" });
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user) {
    return res.json({ message: "Se o email existir, enviaremos instruções de recuperação" });
  }

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

  await prisma.passwordResetToken.create({
    data: {
      token,
      expiresAt,
      userId: user.id,
    },
  });

  res.json({
    message: "Token de recuperação gerado",
    resetToken: token,
  });
}));

app.post("/auth/reset-password", asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ message: "Token e nova senha são obrigatórios" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "A senha deve ter pelo menos 6 caracteres" });
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
    return res.status(400).json({ message: "Token inválido ou expirado" });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { password: await bcrypt.hash(password, 10) },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used: true },
    }),
  ]);

  res.json({ message: "Senha redefinida com sucesso" });
}));

app.get("/accounts", authRequired, asyncHandler(async (req, res) => {
  const accounts = await prisma.account.findMany({
    where: { userId: req.user.id },
    orderBy: {
      id: "desc",
    },
  });

  res.json(accounts);
}));

app.post("/accounts", authRequired, asyncHandler(async (req, res) => {
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
      userId: req.user.id,
    },
  });

  res.status(201).json(account);
}));

app.put("/accounts/:id", authRequired, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, type, balance, color, icon } = req.body;

  const existingAccount = await prisma.account.findFirst({
    where: {
      id: Number(id),
      userId: req.user.id,
    },
  });

  if (!existingAccount) {
    return res.status(404).json({ message: "Conta não encontrada" });
  }

  const account = await prisma.account.update({
    where: { id: existingAccount.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(balance !== undefined ? { balance: toNumber(balance) } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(icon !== undefined ? { icon } : {}),
    },
  });

  res.json(account);
}));

app.delete("/accounts/:id", authRequired, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await prisma.account.deleteMany({
    where: {
      id: Number(id),
      userId: req.user.id,
    },
  });

  if (!result.count) {
    return res.status(404).json({ message: "Conta não encontrada" });
  }

  res.json({ message: "Conta removida com sucesso" });
}));

app.get("/transactions", authRequired, asyncHandler(async (req, res) => {
  const transactions = await prisma.transaction.findMany({
    where: { userId: req.user.id },
    include: { account: true },
    orderBy: { date: "desc" },
    take: 50,
  });

  res.json(transactions);
}));

app.post("/transactions", authRequired, asyncHandler(async (req, res) => {
  const { description, title, amount, category, date, type, accountId } = req.body;
  const parsedAmount = Math.abs(toNumber(amount));
  const parsedAccountId = Number(accountId);

  if (!description && !title) {
    return res.status(400).json({ message: "Descrição é obrigatória" });
  }

  if (!parsedAmount) {
    return res.status(400).json({ message: "Valor inválido" });
  }

  if (!["income", "expense"].includes(type)) {
    return res.status(400).json({ message: "Tipo deve ser receita ou despesa" });
  }

  const account = await prisma.account.findFirst({
    where: {
      id: parsedAccountId,
      userId: req.user.id,
    },
  });

  if (!account) {
    return res.status(404).json({ message: "Conta não encontrada" });
  }

  const signedAmount = type === "income" ? parsedAmount : -parsedAmount;
  const transactionDate = parseTransactionDate(date);

  const [transaction] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        description: description || title,
        amount: signedAmount,
        category: category || "Geral",
        date: transactionDate,
        type,
        accountId: account.id,
        userId: req.user.id,
      },
      include: { account: true },
    }),
    prisma.account.update({
      where: { id: account.id },
      data: { balance: account.balance + signedAmount },
    }),
  ]);

  res.status(201).json(transaction);
}));

app.put("/transactions/:id", authRequired, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { description, title, amount, category, date, type, accountId } = req.body;
  const parsedAmount = Math.abs(toNumber(amount));
  const parsedAccountId = Number(accountId);

  if (!description && !title) {
    return res.status(400).json({ message: "Descrição é obrigatória" });
  }

  if (!parsedAmount) {
    return res.status(400).json({ message: "Valor inválido" });
  }

  if (!["income", "expense"].includes(type)) {
    return res.status(400).json({ message: "Tipo deve ser receita ou despesa" });
  }

  const transaction = await prisma.transaction.findFirst({
    where: { id: Number(id), userId: req.user.id },
  });

  if (!transaction) {
    return res.status(404).json({ message: "Transação não encontrada" });
  }

  const account = await prisma.account.findFirst({
    where: { id: parsedAccountId, userId: req.user.id },
  });

  if (!account) {
    return res.status(404).json({ message: "Conta não encontrada" });
  }

  const signedAmount = type === "income" ? parsedAmount : -parsedAmount;
  const transactionDate = parseTransactionDate(date);
  const accountBalanceUpdates = [
    prisma.account.update({
      where: { id: transaction.accountId },
      data: { balance: { decrement: transaction.amount } },
    }),
    prisma.account.update({
      where: { id: account.id },
      data: { balance: { increment: signedAmount } },
    }),
  ];

  const [updatedTransaction] = await prisma.$transaction([
    prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        description: description || title,
        amount: signedAmount,
        category: category || "Geral",
        date: transactionDate,
        type,
        accountId: account.id,
      },
      include: { account: true },
    }),
    ...accountBalanceUpdates,
  ]);

  res.json(updatedTransaction);
}));

app.delete("/transactions/:id", authRequired, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const transaction = await prisma.transaction.findFirst({
    where: { id: Number(id), userId: req.user.id },
  });

  if (!transaction) {
    return res.status(404).json({ message: "Transação não encontrada" });
  }

  await prisma.$transaction([
    prisma.transaction.delete({ where: { id: transaction.id } }),
    prisma.account.update({
      where: { id: transaction.accountId },
      data: { balance: { decrement: transaction.amount } },
    }),
  ]);

  res.json({ message: "Transação removida com sucesso" });
}));

app.get("/goals", authRequired, asyncHandler(async (req, res) => {
  const goals = await prisma.goal.findMany({
    where: { userId: req.user.id },
    orderBy: { id: "desc" },
  });

  res.json(goals);
}));

app.post("/goals", authRequired, asyncHandler(async (req, res) => {
  const { title, saved, target, color } = req.body;

  if (!title || !target) {
    return res.status(400).json({ message: "Título e valor alvo são obrigatórios" });
  }

  const goal = await prisma.goal.create({
    data: {
      title,
      saved: toNumber(saved),
      target: toNumber(target),
      color,
      userId: req.user.id,
    },
  });

  res.status(201).json(goal);
}));

app.put("/goals/:id", authRequired, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, saved, target, color } = req.body;

  const existingGoal = await prisma.goal.findFirst({
    where: {
      id: Number(id),
      userId: req.user.id,
    },
  });

  if (!existingGoal) {
    return res.status(404).json({ message: "Meta não encontrada" });
  }

  const goal = await prisma.goal.update({
    where: { id: existingGoal.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(saved !== undefined ? { saved: toNumber(saved) } : {}),
      ...(target !== undefined ? { target: toNumber(target) } : {}),
      ...(color !== undefined ? { color } : {}),
    },
  });

  res.json(goal);
}));

app.delete("/goals/:id", authRequired, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await prisma.goal.deleteMany({
    where: {
      id: Number(id),
      userId: req.user.id,
    },
  });

  if (!result.count) {
    return res.status(404).json({ message: "Meta não encontrada" });
  }

  res.json({ message: "Meta removida com sucesso" });
}));

app.get("/dashboard/summary", authRequired, asyncHandler(async (req, res) => {
  const { start, end } = getMonthRange();
  const [accounts, transactions, goals] = await Promise.all([
    prisma.account.findMany({ where: { userId: req.user.id } }),
    prisma.transaction.findMany({
      where: {
        userId: req.user.id,
        date: {
          gte: start,
          lt: end,
        },
      },
      include: { account: true },
      orderBy: { date: "desc" },
      take: 8,
    }),
    prisma.goal.findMany({
      where: { userId: req.user.id },
      orderBy: { id: "desc" },
    }),
  ]);

  const income = transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
  const expenses = transactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
  const totalBalance = accounts.reduce((total, account) => total + account.balance, 0);
  const mainGoal = goals[0] || null;

  res.json({
    totalBalance,
    income,
    expenses,
    monthGoal: income > 0 ? Math.min(Math.round((expenses / income) * 100), 100) : 0,
    weeklySpending: expenses,
    accounts,
    transactions,
    goals,
    mainGoal,
  });
}));

app.use((error, req, res, _next) => {
  console.error(error);

  if (error.code === "P2025") {
    return res.status(404).json({ message: "Registro não encontrado" });
  }

  res.status(500).json({ message: "Erro interno no servidor" });
});

app.listen(3333, () => {
  console.log("API rodando em http://localhost:3333");
});
