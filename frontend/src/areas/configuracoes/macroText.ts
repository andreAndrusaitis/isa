export function unknownMessage(unknown: string[]) {
  const list = unknown.map((k) => `{${k}}`).join(', ')
  return unknown.length === 1
    ? `${list} não é uma variável válida e será enviada como texto.`
    : `${list} não são variáveis válidas e serão enviadas como texto.`
}
