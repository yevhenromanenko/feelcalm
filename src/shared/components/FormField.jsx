export default function FormField({ className = "field", label, htmlFor, labelRowExtra, children }) {
  return (
    <div className={className}>
      {labelRowExtra ? (
        <div className="label-row">
          <label htmlFor={htmlFor}>{label}</label>
          {labelRowExtra}
        </div>
      ) : (
        <label htmlFor={htmlFor}>{label}</label>
      )}
      {children}
    </div>
  );
}
