# 📚 Pasta de Manuais Pré-carregados

Coloque aqui os arquivos PDF/DOCX que você quer que sejam **carregados automaticamente** quando o servidor iniciar.

## Como usar

1. Copie seus manuais (PDF ou DOCX) para esta pasta `seed-manuals/`
2. Faça commit no GitHub: `git add . && git commit -m "Adiciona manuais" && git push`
3. O Render fará deploy automaticamente
4. Quando o servidor iniciar, os manuais serão importados automaticamente
5. Qualquer pessoa acessando o link já encontra os manuais carregados!

## Limitações no Render gratuito

- Arquivos individuais devem ter no máximo **100 MB**
- O total do repositório (com os manuais) deve caber em **1 GB**
- As **imagens das páginas não serão geradas** (Ghostscript não disponível) — apenas texto
- Para que as miniaturas funcionem, use o sistema localmente no PC

## Importante

- Os manuais aqui ficam **públicos** se seu repositório GitHub for público
- Use repositório **privado** se os manuais forem confidenciais
- Manuais já importados em sessões anteriores NÃO são reimportados (verificação por nome)
