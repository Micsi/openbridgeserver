/**
 * dependency-cruiser config for the obs Visu workspace.
 *
 * Golden rule (1)+(4): one model, skins are read-only and never own state; the
 * Host maps gestures to canonical actions. The core layer must therefore stay
 * independent of any skin. This rule is forward-looking — in M1 there are no
 * skins yet, so it runs green/empty.
 */
module.exports = {
  forbidden: [
    {
      name: 'core-no-skin-import',
      comment:
        'apps/visu/src/core/** must never import from a skin (any module path matching *skins*). ' +
        'The core owns the model and state; skins read it, never the other way around.',
      severity: 'error',
      from: { path: '^apps/visu/src/core/' },
      to: { path: 'skins' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json'],
    },
    tsPreCompilationDeps: true,
  },
};
