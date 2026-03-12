# Generate Design Flow (llm-service)

## Architecture Type
- **Current setup is a true multi-agent loop inside `AgentService` orchestration**.
- Logical agents and responsibilities:
  - **PlannerAgent**: builds architecture blueprint (actors, FR/NFR, entities, APIs, async workflows).
  - **DesignerAgent**: LangChain tool-calling agent that creates/iterates visual design.
  - **ValidatorAgent**: scores generated design against requirements.
  - **RefinerAgent**: emits directives and updates blueprint for next retry.
- Retry behavior is **threshold-driven** (`validationThreshold`) with bounded retries (`maxRefinementCycles`).

## End-to-End Flow

```mermaid
flowchart TD
  A[Client: POST /agent/generate-design] --> B[AgentController\nvalidate query + auth token]
  B --> C[AgentService.generateDesign]

  C --> D{enableRagContext?}
  D -- yes --> E[RagService.getRelevantDocuments\nQdrant similarity search]
  D -- no --> F[Skip RAG]
  E --> G[Build RAG context snippets]
  F --> H[Generate Blueprint without RAG]
  G --> I[PlannerAgent\ngenerateBlueprint]
  H --> I

  I --> J[Initialize retry config\nvalidationThreshold + maxRefinementCycles]
  J --> K[DesignerAgent\ncreateAgentExecutor + invoke]

  K --> M[DesignToolsService tools]
  M --> M1[search_existing_designs]
  M --> M2[get_design_by_id]
  M --> M3[create_system_design]
  M3 --> N[design-service: POST /api/v1/designs]

  N --> O[Extract designId from intermediate steps]
  O --> P[fetchDesignById]

  P --> Q{enableValidationLoop?}
  Q -- yes --> R[ValidatorAgent\nvalidateDesignAgainstRequirements]
  Q -- no --> S[Skip validation\nscore=100]

  R --> T{score >= validationThreshold?}
  S --> T
  T -- yes --> U[Select best attempt]
  T -- no --> V{retry budget left?}
  V -- no --> U
  V -- yes --> W[RefinerAgent\ngenerateRefinementDirectives]
  W --> X[PlannerAgent\napplyRefinementToBlueprint]
  X --> K

  U --> Y[Build ADR blob: ADR_designId\ninclude attempt history]
  Y --> Z[attachDesignContext\ndesign-service PUT /api/v1/designs/:id\ncontext.adr + context.architectureBlueprint + context.validationReport]
  Z --> AA[Return DesignResultDto\nvalidationScore + validationThreshold + thresholdMet + refinementCyclesUsed]
```

## Validation Behavior Today
- Validation is **iterative with retry-until-threshold logic**.
- The loop stops when one of these is true:
  - score meets/exceeds threshold,
  - retries exhausted,
  - validation loop disabled.
- Best-scoring attempt is selected and persisted with ADR metadata.

## What Makes It “Agentic” Right Now
- Planner/Designer/Validator/Refiner are explicit logical agents with distinct prompts and responsibilities.
- DesignerAgent uses external tools for design creation; other agents are reasoning agents over structured JSON.
- This is a **multi-agent looped orchestration architecture** (coordinated in one service process).
