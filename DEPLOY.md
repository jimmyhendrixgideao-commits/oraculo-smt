# 🚀 Guia de Deploy do Oráculo SMT no Render.com

Este guia mostra como colocar o ORÁCULO SMT online 24/7 com link público para demonstração.

---

## Pré-requisitos

- Conta no GitHub (gratuita) — https://github.com/signup
- Conta no Render.com (gratuita) — https://render.com/signup
- As chaves API que você já tem do Gemini e Claude

---

## Passo 1 — Subir o projeto para o GitHub

1. Acesse https://github.com e faça login
2. Clique em **"New repository"** (botão verde no canto superior direito)
3. Nome do repositório: **`oraculo-smt`**
4. Marque como **Private** (privado, apenas você vê o código)
5. Clique em **Create repository**
6. Na próxima tela, copie a URL do seu repositório (ex: `https://github.com/seu-usuario/oraculo-smt.git`)

### Enviar o código:

Abra o CMD na pasta do projeto e execute (substitua a URL pela sua):

```bash
cd C:\Users\jimmy\Downloads\oraculo-smt
git init
git add .
git commit -m "Versão inicial do Oráculo SMT"
git branch -M main
git remote add origin https://github.com/seu-usuario/oraculo-smt.git
git push -u origin main
```

Se pedir login, use seu usuário do GitHub. Se der erro de senha, gere um **Personal Access Token** em github.com → Settings → Developer settings → Personal access tokens → Generate new token (escolha permissão "repo").

---

## Passo 2 — Criar o serviço no Render

1. Acesse https://render.com e faça login
2. No painel, clique em **"New +"** → **"Web Service"**
3. Conecte sua conta do GitHub se ainda não conectou
4. Selecione o repositório **`oraculo-smt`**
5. Configure:
   - **Name:** `oraculo-smt` (ou outro nome de sua preferência)
   - **Region:** São Paulo (mais próximo do Brasil)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `apt-get update && apt-get install -y ghostscript && npm install`
   - **Start Command:** `node server.js`
   - **Plan:** `Free`

6. Role até **"Environment Variables"** e adicione:
   - **Key:** `GEMINI_API_KEY` — **Value:** sua chave Gemini (`AIza...`)
   - **Key:** `CLAUDE_API_KEY` — **Value:** sua chave Claude (`sk-ant-...`)

7. Clique em **"Create Web Service"**

---

## Passo 3 — Aguardar o deploy

O Render vai:
1. Baixar o código do GitHub
2. Instalar Ghostscript (necessário para imagens dos PDFs)
3. Instalar as dependências Node.js
4. Iniciar o servidor

Tempo estimado: **5 a 8 minutos**.

Quando terminar, você verá um link tipo: **`https://oraculo-smt.onrender.com`**

---

## Passo 4 — Compartilhar a demo

Pronto! Envie o link para qualquer pessoa. Eles podem:

✅ Acessar via PC, celular, tablet — qualquer dispositivo com navegador
✅ Carregar manuais PDF/DOCX
✅ Fazer perguntas técnicas
✅ Escolher entre **suas próprias chaves** ou **chave do servidor** (a sua)
✅ Ver imagens dos manuais nas respostas

---

## Observações Importantes

⚠️ **Plano gratuito do Render:**
- Servidor "dorme" após 15 min de inatividade — primeira requisição leva ~30 seg para acordar
- 750 horas/mês gratuitas (suficiente para demos)
- 512 MB RAM, 0.1 CPU

⚠️ **Armazenamento:**
- Manuais carregados ficam temporários (resetam em cada deploy)
- Para produção real, contrate o plano pago ou use armazenamento externo

⚠️ **Custos das APIs:**
- Quando o usuário marca "Usar chave do servidor", as consultas saem da SUA cota Gemini/Claude
- Recomende para demos rápidas — para uso intensivo peça que insiram a própria chave

---

## Atualizar o sistema depois

Sempre que quiser publicar uma nova versão:

```bash
cd C:\Users\jimmy\Downloads\oraculo-smt
git add .
git commit -m "Descrição da atualização"
git push
```

O Render detecta automaticamente e refaz o deploy em poucos minutos!

---

**Criado por Jimmy Hendrix Queiroz**
*Sistema Inteligente de Suporte Técnico para Indústria SMT*
