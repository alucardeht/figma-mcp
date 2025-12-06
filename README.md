# Figma MCP Server v2.0

MCP server inteligente para Figma com navegação conversacional, extração de assets organizada e respeito a rate limits.

## Características Principais

- **Navegação por nome** - Busca páginas e frames por nome (partial match), sem precisar de IDs
- **Output compacto** - JSON estruturado que não estoura a janela de contexto
- **Rate limiting inteligente** - Respeita os tiers da API do Figma automaticamente
- **Cache de requests** - Evita chamadas duplicadas à API
- **Assets organizados** - Separa automaticamente em `icons/` e `images/`
- **Extração de design tokens** - Cores, fontes, espaçamentos como JSON
- **Screenshots segmentados** - Divide frames grandes em tiles menores

## Instalação

```bash
npm install
export FIGMA_API_TOKEN="seu-token-aqui"
```

### Como obter o token do Figma:
1. Acesse https://www.figma.com/
2. Vá em Settings > Account > Personal access tokens
3. Crie um novo token
4. Copie e use na variável de ambiente acima

## Configuração no Claude Desktop

```json
{
  "mcpServers": {
    "figma": {
      "command": "node",
      "args": ["/caminho/para/figma-mcp-server/index.js"],
      "env": {
        "FIGMA_API_TOKEN": "seu-token-aqui"
      }
    }
  }
}
```

## Tools Disponíveis

### 1. `list_pages`
Lista todas as páginas de um arquivo Figma.

```
"Quais páginas tem no arquivo figma.com/design/ABC123?"
```

**Retorna:** Nome, ID e quantidade de frames de cada página.

### 2. `list_frames`
Lista frames dentro de uma página específica. Busca por nome (partial match).

```
"Me mostra os frames da página 'Mobile'"
```

**Retorna:** Nome, dimensões, tipo e quantidade de filhos de cada frame.

### 3. `get_frame_info`
Obtém informações detalhadas de um frame: componentes, textos, cores, estilos.

```
"Me dá os detalhes do frame 'Login Screen' na página 'Mobile'"
```

**Parâmetros:**
- `depth`: Profundidade de análise (1-4, default: 2)

**Retorna:** Árvore de componentes com bounds, fills, strokes, effects, layout, etc.

### 4. `get_screenshot`
Captura screenshot de um frame. Segmenta automaticamente frames grandes.

```
"Captura o frame 'Dashboard' da página 'Desktop'"
```

**Parâmetros:**
- `scale`: 1-4 (default: 2)
- `max_dimension`: Tamanho máximo antes de segmentar (default: 4096)

**Retorna:** Imagem base64 (ou múltiplos tiles se for muito grande).

### 5. `extract_styles`
Extrai todos os design tokens de um frame.

```
"Extrai os estilos do frame 'Home'"
```

**Retorna:**
```json
{
  "designTokens": {
    "colors": ["#FFFFFF", "#000000", "#3B82F6"],
    "fonts": ["Inter", "Roboto"],
    "fontSizes": [12, 14, 16, 24],
    "borderRadii": [4, 8, 16],
    "spacing": [8, 12, 16, 24],
    "shadows": [...]
  }
}
```

### 6. `extract_assets`
Extrai todos os assets de um frame, organizando em pastas.

```
"Extrai os assets do frame 'Onboarding' e salva em ./assets"
```

**Organização automática:**
```
output_dir/
├── icons/
│   ├── arrow-left.svg
│   ├── menu-icon.svg
│   └── logo.svg
└── images/
    ├── hero-banner.png
    └── profile-avatar.png
```

**Detecção inteligente:**
- Ícones: Elementos com keywords (icon, arrow, chevron, logo) ou vetores pequenos → SVG
- Imagens: Elementos com image fill ou keywords (photo, banner, hero) → PNG

### 7. `search_components`
Busca componentes por nome em todo o arquivo ou página específica.

```
"Busca todos os 'Button' no arquivo"
"Busca 'Icon' só na página 'Design System'"
```

**Parâmetros:**
- `query`: Termo de busca (case-insensitive)
- `page_name`: Opcional, limita a busca
- `type`: Filtro por tipo (COMPONENT, INSTANCE, FRAME, TEXT, VECTOR, etc.)

### 8. `get_file_styles`
Obtém estilos publicados do design system (cores, textos, efeitos).

```
"Quais são os estilos definidos no arquivo?"
```

## Workflow Típico

```
1. "Quais páginas tem no arquivo ABC123?"
   → list_pages retorna: Mobile, Desktop, Design System

2. "Me mostra os frames da página Mobile"
   → list_frames retorna: Login, Home, Profile, Settings

3. "Me dá os detalhes do frame Login"
   → get_frame_info retorna: componentes, textos, cores

4. "Captura um screenshot do Login"
   → get_screenshot retorna: imagem base64

5. "Extrai todos os assets do Login"
   → extract_assets salva em icons/ e images/

6. "Quais são os design tokens usados?"
   → extract_styles retorna: cores, fontes, espaçamentos
```

## Rate Limiting

O servidor gerencia automaticamente os rate limits da API do Figma:

| Tier | Endpoints | Limite |
|------|-----------|--------|
| 1 | GET files, images | 10 req/min |
| 2 | GET styles | 25 req/min |
| 3 | GET metadata | 50 req/min |

- Implementa leaky bucket algorithm
- Retry automático com backoff em caso de 429
- Cache de requests para evitar chamadas duplicadas

## Vantagens sobre MCPs tradicionais

| Problema | Solução |
|----------|---------|
| Overflow de contexto | Output JSON compacto e estruturado |
| Precisa copiar IDs manualmente | Busca por nome com partial match |
| Assets desorganizados | Separação automática icons/images |
| Sem extração de estilos | Design tokens como JSON |
| Screenshots muito grandes | Segmentação automática |
| Estoura rate limit | Gerenciamento inteligente por tier |
| Calls desnecessárias | Cache de requests |

## Licença

MIT
