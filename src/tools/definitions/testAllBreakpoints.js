import { z } from 'zod';

export const name = 'test_all_breakpoints';
export const description = 'Test multiple breakpoints and aggregate results. Provides comprehensive responsive validation report. Returns overall status, per-breakpoint results, recommendations.';

export const inputSchema = {
  breakpoints: z.array(
    z.object({
      name: z.string().optional().describe('Breakpoint name'),
      width: z.number().describe('Viewport width'),
      height: z.number().optional().describe('Viewport height (optional)'),
      figma_frame: z.string().optional().describe('Corresponding Figma frame name')
    })
  ).describe('Array of breakpoints to test'),
  validation_results_by_breakpoint: z.record(z.any())
    .describe('Map of breakpoint name/width → validation results')
};

export async function handler(args, ctx) {
  const { chunker } = ctx;
  const {
    breakpoints,
    validation_results_by_breakpoint
  } = args;

  if (!breakpoints || !Array.isArray(breakpoints)) {
    throw new Error('breakpoints must be an array of {name, width, height?, figma_frame?}');
  }

  if (!validation_results_by_breakpoint) {
    throw new Error('validation_results_by_breakpoint object is required - run validations at each breakpoint first');
  }

  const results = [];
  let passedBreakpoints = 0;
  let failedBreakpoints = 0;

  for (const bp of breakpoints) {
    const bpKey = bp.name || `${bp.width}px`;
    const bpResults = validation_results_by_breakpoint[bpKey];

    if (!bpResults) {
      results.push({
        breakpoint: bpKey,
        width: bp.width,
        status: 'NOT_TESTED',
        reason: 'No validation results provided for this breakpoint'
      });
      continue;
    }

    let passed = 0;
    let failed = 0;
    const issues = [];

    for (const [type, result] of Object.entries(bpResults)) {
      if (result.status === 'PASS') passed++;
      else if (result.status === 'FAIL') {
        failed++;
        issues.push(`${type}: ${result.summary || 'failed'}`);
      }
    }

    const bpStatus = failed > 0 ? 'FAIL' : 'PASS';
    if (bpStatus === 'PASS') passedBreakpoints++;
    else failedBreakpoints++;

    results.push({
      breakpoint: bpKey,
      width: bp.width,
      figma_frame: bp.figma_frame,
      status: bpStatus,
      validations_passed: passed,
      validations_failed: failed,
      issues: issues.length > 0 ? issues : undefined
    });
  }

  const overallStatus = failedBreakpoints > 0 ? 'FAIL' : 'PASS';

  const result = {
    status: overallStatus,
    total_breakpoints: breakpoints.length,
    passed: passedBreakpoints,
    failed: failedBreakpoints,
    not_tested: breakpoints.length - passedBreakpoints - failedBreakpoints,
    breakpoints: results,
    summary: `${passedBreakpoints}/${breakpoints.length} breakpoints passed responsive validation`
  };

  if (failedBreakpoints > 0) {
    result.recommendation = `Focus on fixing: ${results.filter(r => r.status === 'FAIL').map(r => r.breakpoint).join(', ')}`;
  }

  const response = chunker ? chunker.wrapResponse(result, {
    step: "Multi-breakpoint responsive validation",
    progress: `Tested ${breakpoints.length} breakpoints`,
    nextStep: failedBreakpoints > 0
      ? `Fix issues at ${failedBreakpoints} failing breakpoint(s)`
      : "Responsive validation complete!"
  }) : result;

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
  };
}
