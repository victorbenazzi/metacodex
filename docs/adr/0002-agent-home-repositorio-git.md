# O diretório de cada Agente é um repositório git

> **Superseded (2026-07-02):** o Agent view e as entidades de Agente foram removidos do produto no v0.0.12 e não voltarão. Este ADR permanece apenas como registro histórico; nada aqui descreve o app atual.

O diretório do Agente (`~/.metacodex/agents/<slug>/`: definição, memória, agenda, reports, logs, diário) é inicializado como repositório git, e o harness commita checkpoints após cada execução, dream e proposta aplicada. Ganhos: rollback da evolução do agente ("voltar o agente de ontem"), auditoria de como memória e persona mudaram com o tempo, e o deploy futuro para runner externo (ADR 0001: trigger.dev, GitHub Actions, VPS) vira `git push/pull` em vez de protocolo de sincronização inventado. Alternativa rejeitada: versionar só a definição em cópias numeradas (não cobre memória nem dá caminho de deploy).
