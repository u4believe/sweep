import { secretInputProps } from "@/lib/utils";
import { BIOMETRIC_NAME, type useBiometricApproval } from "@/lib/biometric";

/**
 * "Approve with Face ID / fingerprint" when this device is set up (with
 * "Use password instead"), otherwise the transaction password field.
 */
export function ApprovalField({ bio, id, value, onChange, placeholder, fieldClass, labelClass }: {
  bio: ReturnType<typeof useBiometricApproval>;
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  fieldClass: string;
  labelClass: string;
}) {
  if (bio.active) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-(--sw-tint) px-4 py-3">
        <span className="min-w-0">
          <span className="block text-[13px] font-bold text-(--sw-ink)">Approve with {BIOMETRIC_NAME}</span>
          <span className="block text-xs text-(--sw-muted)">You'll be asked when you confirm.</span>
        </span>
        <button type="button" onClick={() => bio.setUsePassword(true)} className="text-[13px] font-bold text-(--sw-blue) whitespace-nowrap">Use password instead</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className={labelClass}>Transaction password</label>
        {bio.available && (
          <button type="button" onClick={() => bio.setUsePassword(false)} className="text-[13px] font-bold text-(--sw-blue) whitespace-nowrap">Use {BIOMETRIC_NAME}</button>
        )}
      </div>
      <input id={id} type="password" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} {...secretInputProps} className={fieldClass} />
    </div>
  );
}
