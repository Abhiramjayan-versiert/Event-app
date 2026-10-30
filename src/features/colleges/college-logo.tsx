"use client";

import { BrandingUploader } from "@/components/forms/branding-uploader";
import { setCollegeLogoAction } from "@/features/colleges/actions";

export function CollegeLogo({ collegeId, logoPath }: { collegeId: string; logoPath: string | null }) {
  return <BrandingUploader folder={`colleges/${collegeId}`} currentPath={logoPath} onSaved={(path) => setCollegeLogoAction(collegeId, path)} />;
}
