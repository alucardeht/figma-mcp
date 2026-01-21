export async function validateResponsiveBreakpoint(ctx, args) {
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

export async function testAllBreakpoints(ctx, args) {
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
