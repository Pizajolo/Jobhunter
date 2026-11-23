import type { ComponentType } from 'react';
import type { SectionProps } from './sections';

/** Settings sections added by later features (email, scanning, applying, data…), in display order. */
export const extraSections: ComponentType<SectionProps>[] = [];
