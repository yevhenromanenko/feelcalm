export default function ActionButton({ className = "", type = "button", children, ...props }) {
  const classes = className ? className : "";
  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
