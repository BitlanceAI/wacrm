'use client';

import { TemplateManager } from '@/components/settings/template-manager';

/**
 * Standalone Templates page. The manager used to live only as a tab
 * under Settings; templates are day-to-day working material (every
 * broadcast starts from one), so they get a first-class sidebar entry.
 * Old links to /settings?tab=templates redirect here.
 */
export default function TemplatesPage() {
  return (
    <div className="space-y-6">
      <TemplateManager />
    </div>
  );
}
