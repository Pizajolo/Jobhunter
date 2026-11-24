import type { ComponentType } from 'react';
import type { SectionProps } from './sections';
import { CompaniesSection, ScanSection, SearchSection, SourcesSection } from './scanning';
import { CvSection } from './documents';

/** Settings sections added by later features (email, scanning, applying, data…), in display order. */
export const extraSections: ComponentType<SectionProps>[] = [ScanSection, SearchSection, CompaniesSection, SourcesSection, CvSection];
