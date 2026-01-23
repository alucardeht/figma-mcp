export function filterTokensByTypes(tokens, types) {
  if (!types || types.length === 0) {
    return tokens;
  }

  const filtered = {};

  const typeMapping = {
    colors: 'color',
    fonts: 'typography',
    fontSizes: 'fontSize',
    spacing: 'dimension',
    radii: 'radius',
    shadows: 'shadow',
    effects: 'shadow',
    grids: 'grid',
  };

  types.forEach((type) => {
    const tokenType = typeMapping[type];
    if (tokenType && tokens[tokenType]) {
      filtered[tokenType] = tokens[tokenType];
    }
  });

  return filtered;
}

export function tokensToCSS(tokens) {
  const cssVariables = {};
  const cssContent = [];

  const processTokens = (obj, prefix = '') => {
    Object.entries(obj).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        processTokens(value, prefix ? `${prefix}-${key}` : key);
      } else if (typeof value === 'string') {
        const varName = prefix ? `${prefix}-${key}` : key;
        const cssVarName = `--${varName
          .replace(/([A-Z])/g, '-$1')
          .toLowerCase()
          .replace(/^-/, '')}`;

        cssVariables[cssVarName] = value;
        cssContent.push(`${cssVarName}: ${value};`);
      }
    });
  };

  processTokens(tokens);

  return {
    variables: cssVariables,
    content: `:root {\n  ${cssContent.join('\n  ')}\n}`,
  };
}

export function tokensToTailwind(tokens) {
  const config = {
    colors: {},
    fontSize: {},
    spacing: {},
    borderRadius: {},
    boxShadow: {},
  };

  const flattenObject = (obj, prefix = '') => {
    const result = {};
    Object.entries(obj).forEach(([key, value]) => {
      const newKey = prefix ? `${prefix}-${key}` : key;
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.assign(result, flattenObject(value, newKey));
      } else if (typeof value === 'string') {
        result[newKey] = value;
      }
    });
    return result;
  };

  if (tokens.color) {
    config.colors = flattenObject(tokens.color);
  }

  if (tokens.fontSize) {
    config.fontSize = flattenObject(tokens.fontSize);
  }

  if (tokens.dimension) {
    config.spacing = flattenObject(tokens.dimension);
  }

  if (tokens.radius) {
    config.borderRadius = flattenObject(tokens.radius);
  }

  if (tokens.shadow) {
    config.boxShadow = flattenObject(tokens.shadow);
  }

  return {
    theme: {
      extend: config,
    },
  };
}
