# Agentes vivem em arquivos planos portáveis; o scheduler é trocável, sem daemon

> **Superseded (2026-07-02):** o Agent view e as entidades de Agente foram removidos do produto no v0.0.12 e não voltarão. Este ADR permanece apenas como registro histórico; nada aqui descreve o app atual.

Agentes (Agent View) precisam de autonomia (heartbeat, cron, dream), mas decidimos NÃO criar um daemon residente: as execuções agendadas disparam pelo scheduler Rust existente apenas enquanto o app está aberto, com catch-up ao reabrir. Em troca, toda a identidade do Agente (definição, memória, agenda, logs) vive como arquivos planos num diretório próprio, sem nenhuma dependência do processo do app, para que um runner externo (trigger.dev, GitHub Actions, Railway, VPS comum) possa adotar os mesmos arquivos depois. Mesma lógica do cron já existente: a string cron padrão e os arquivos do agente são o artefato de portabilidade; "quem dispara" é detalhe substituível.

## Considered Options

- Daemon/launchd residente: autonomia 24/7 local, rejeitado pelo custo (lifecycle, update, bateria, opencode full-auto sem supervisão).
- Runner externo desde o início: dilui o local-first e adiciona infra antes de validar o produto.
