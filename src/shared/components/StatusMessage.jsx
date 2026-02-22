export default function StatusMessage({ id, text, isError = false, className = "status" }) {
  const errorClass = isError ? " err" : "";
  return (
    <div id={id} className={`${className}${errorClass}`}>
      {text}
    </div>
  );
}
