# Canal do Mengão — GitHub Actions (sem custo, sem cartão)

Roda a cada 15 minutos: desfalques/retornos, lembrete de jogo (até 2h antes) e placar final.
Posta no canal do Telegram. O WhatsApp continua manual (copie o texto que o bot publicar).

## Passo a passo (tudo pelo site do GitHub)
1. Crie um repositório **público** chamado `canal-mengo` (público = minutos de Actions ilimitados;
   os tokens ficam nos *Secrets*, que nunca aparecem, mesmo em repositório público).
2. Em **Add file → Upload files**, envie `run.js`, `state.json` e `README.md`. Confirme (Commit).
3. Crie o workflow: **Add file → Create new file**, digite no nome exatamente
   `.github/workflows/canal.yml` e cole o conteúdo do arquivo `canal.yml`. Confirme.
4. **Settings → Secrets and variables → Actions → aba Secrets → New repository secret**:
   - `BSD_TOKEN` = token NOVO da API Bzzoiro
   - `TG_TOKEN`  = token NOVO do bot do Telegram
5. Na aba **Variables → New repository variable**:
   - `TG_CHAT`  = `-1004430678817`
   - `APP_LINK` = link do app na Play Store
   - `DRY_RUN`  = `true`
6. **Settings → Actions → General → Workflow permissions** → marque **Read and write permissions** → Save.
7. Aba **Actions → Canal Mengao → Run workflow**. Abra a execução e leia o log: as mensagens que
   seriam enviadas aparecem ali (modo teste, nada vai ao canal).
8. Quando estiver tudo certo, mude a variável `DRY_RUN` para `false`.

## Observações
- A 1ª execução só grava o estado atual (não posta o que já existia).
- O GitHub pode atrasar execuções agendadas (às vezes 10 a 30 min nos horários de pico).
- Em repositório público, o GitHub desativa agendamentos após ~60 dias sem atividade no repositório.
  Se parar de rodar, entre em Actions e reative.
- Repositório PRIVADO: use `cron: "*/30 * * * *"` para caber nos 2.000 min/mês gratuitos.
- Nunca coloque tokens dentro dos arquivos do repositório.
