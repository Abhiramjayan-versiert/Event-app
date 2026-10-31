"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildCertificatePdf, type CertificateData } from "./pdf";

export function CertificateDownload({ data, verifyUrl }: { data: CertificateData; verifyUrl: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const buf = await buildCertificatePdf(data, verifyUrl);
          const url = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = `certificate-${data.recipient_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
        } catch {
          toast.error("Could not create the PDF.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download /> Download certificate (PDF)
    </Button>
  );
}
