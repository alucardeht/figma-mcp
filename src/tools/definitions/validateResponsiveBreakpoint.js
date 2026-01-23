import { z } from 'zod';

export const name = 'validate_responsive_breakpoint';
export const description = 'Validate implementation at specific breakpoint. Aggregates results from check_layout_bounds, verify_elements_present, verify_assets_loaded, compare_visual. Returns overall status and priority fixes.';

export const inputSchema = {
  breakpoint_name: z.string()
    .optional()
    .describe('Name of breakpoint (e.g., "mobile", "tablet", "desktop")'),
  viewport: z.object({
    width: z.number().describe('Viewport width'),
    height: z.number().describe('Viewport height').optional()
  })
    .describe('Viewport dimensions'),
  figma_frame_name: z.string()
    .optional()
    .describe('Name of corresponding Figma frame for this breakpoint'),
  validation_results: z.record(z.any())
    .describe('Results from other validations: {layout_bounds, elements_present, assets_loaded, visual}')
};

function identifyPriorityFixes(validations) {
  const fixes = [];

  if (validations.layout_bounds?.status === 'FAIL') {
    fixes.push({
      priority: 1,
      type: 'layout',
      action: 'Fix element overflow issues - elements extending beyond containers'
    });
  }

  if (validations.elements_present?.status === 'FAIL') {
    fixes.push({
      priority: 2,
      type: 'elements',
      action: 'Add missing required elements to the DOM'
    });
  }

  if (validations.assets_loaded?.status === 'FAIL') {
    fixes.push({
      priority: 3,
      type: 'assets',
      action: 'Fix broken images/icons - check file paths and loading'
    });
  }

  if (validations.visual?.status === 'FAIL') {
    fixes.push({
      priority: 4,
      type: 'visual',
      action: 'Address visual differences - check colors, fonts, spacing'
    });
  }

  return fixes.sort((a, b) => a.priority - b.priority);
}

export async function handler(args, ctx) {
  const { chunker } = ctx;
  const {
    breakpoint_name,
    viewport,
    figma_frame_name,
    validation_results
  } = args;

  if (!viewport || !viewport.width) {
    throw new Error('viewport {width, height} is required');
  }

  if (!validation_results) {
    throw new Error('validation_results object is required with results from other validation tools');
  }

  const aggregated = {
    breakpoint: breakpoint_name || `${viewport.width}px`,
    viewport,
    figma_frame: figma_frame_name,
    validations: {},
    passed: 0,
    failed: 0,
    warnings: 0
  };

  const validationTypes = ['layout_bounds', 'elements_present', 'assets_loaded', 'visual'];

  for (const type of validationTypes) {
    if (validation_results[type]) {
      const result = validation_results[type];
      aggregated.validations[type] = {
        status: result.status,
        summary: result.summary || `${type}: ${result.status}`
      };

      if (result.status === 'PASS') aggregated.passed++;
      else if (result.status === 'FAIL') aggregated.failed++;
      else if (result.status === 'WARNING') aggregated.warnings++;

      if (result.status === 'FAIL' && result.issues) {
        aggregated.validations[type].issues = result.issues.slice(0, 3);
      }
    }
  }

  const totalValidations = aggregated.passed + aggregated.failed + aggregated.warnings;
  let overallStatus = 'PASS';
  if (aggregated.failed > 0) overallStatus = 'FAIL';
  else if (aggregated.warnings > 0) overallStatus = 'WARNING';

  const result = {
    status: overallStatus,
    breakpoint: aggregated.breakpoint,
    viewport,
    figma_frame: figma_frame_name,
    validations_run: totalValidations,
    passed: aggregated.passed,
    failed: aggregated.failed,
    warnings: aggregated.warnings,
    details: aggregated.validations,
    summary: `${aggregated.breakpoint}: ${aggregated.passed}/${totalValidations} validations passed`
  };

  if (aggregated.failed > 0) {
    result.priority_fixes = identifyPriorityFixes(aggregated.validations);
  }

  const response = chunker ? chunker.wrapResponse(result, {
    step: `Responsive validation at ${aggregated.breakpoint}`,
    progress: `${aggregated.passed}/${totalValidations} passed`,
    nextStep: aggregated.failed > 0
      ? `Fix ${aggregated.failed} failing validation(s) at ${aggregated.breakpoint}`
      : "Test next breakpoint or complete validation"
  }) : result;

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
  };
}
