import { secretInputProps } from "@/lib/utils";
import { BIOMETRIC_NAME, type useBiometricApproval } from "@/lib/biometric";

/**
 * Just a "Use password instead" link when this device approves with Face ID /
 * fingerprint, otherwise the transaction password field.
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
      <div className="flex justify-center">
        <button type="button" onClick={() => bio.setUsePassword(true)} className="text-[13px] font-bold text-(--sw-blue) whitespace-nowrap py-1">Use password instead</button>
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
