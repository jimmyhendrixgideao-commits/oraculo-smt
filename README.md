# ORÁCULO SMT — Guia de Uso

## O que é
Sistema inteligente de suporte técnico para técnicos e engenheiros de SMT. 
Responde perguntas baseadas em manuais de máquinas e experiências técnicas do cotidiano.

---

## Como instalar e rodar

### Pré-requisitos
- Windows 10 ou 11
- Node.js instalado (https://nodejs.org — versão LTS recomendada)
- Chave de API Claude (https://console.anthropic.com)

### Iniciando o sistema
1. Extraia a pasta `oraculo-smt` em qualquer lugar do seu computador
2. Dê duplo clique no arquivo **`INICIAR.bat`**
3. Na primeira vez, o sistema instala as dependências automaticamente
4. O navegador abre sozinho em `http://localhost:3000`

---

## Como usar

### 1. Configure a chave API
- No topo da tela, insira sua chave de API Claude (`sk-ant-...`)
- A chave fica salva no navegador para próximas sessões

### 2. Carregue manuais
- Clique na área de upload ou arraste arquivos PDF/DOC/DOCX
- Manuais em português ou inglês são aceitos
- Para PDFs protegidos ou escaneados, o sistema tenta extrair o texto automaticamente

### 3. Faça perguntas
- Digite qualquer pergunta técnica em português ou inglês
- O ORÁCULO responde **sempre em português**
- Use os atalhos rápidos para perguntas comuns
- Marque/desmarque manuais no painel para filtrar a busca

### 4. Registre experiências
- Vá na aba **Experiências** no painel lateral
- Registre situações reais de processo com problema e solução
- As experiências ficam salvas e são consultadas junto com os manuais

---

## Termos técnicos reconhecidos automaticamente
O ORÁCULO entende abreviações e termos comuns do setor:

| Termo usado | O que significa |
|---|---|
| Printer | Impressora de pasta de solda |
| P&P | Pick and Place |
| Reflow | Forno de refluxo |
| AOI | Inspeção Óptica Automática |
| SPI | Inspeção de Pasta de Solda |
| Tombstone / lápide | Componente levantado na solda |
| Solder bridge | Ponte de solda entre trilhas |
| Misprint | Impressão defeituosa de pasta |
| Squeegee | Rodo/espátula da impressora |
| Stencil | Máscara de impressão |
| Placement offset | Desvio de posicionamento |

---

## Dados e privacidade
- Todos os dados ficam **salvos localmente** no seu computador
- Pasta `data/knowledge.json` — base de conhecimento
- Pasta `uploads/` — arquivos enviados
- Nada é enviado para servidores externos, exceto a pergunta para a API Claude

---

## Suporte
Para dúvidas ou melhorias, entre em contato com o desenvolvedor do sistema.
