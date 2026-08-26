// Your books live here. Each entry needs:
//   id:    unique short slug (used in the URL and to remember your place)
//   title: shown on the library card and reader header
//   author:(optional) shown under the title
//   type:  "epub" or "pdf"
//   url:   direct link to the file. Must allow cross-origin reads —
//          GitHub Pages and raw.githubusercontent.com both work.
//
// Examples:
//   https://<user>.github.io/<repo>/alice.epub
//   https://raw.githubusercontent.com/<user>/<repo>/main/alice.epub

export interface Book {
  id: string;
  title: string;
  author?: string;
  type: "epub" | "pdf";
  url: string;
}

export const BOOKS: Book[] = [
  // ---- Local library (public/books/) ----
  {
    id: "how-prime-ministers-decide",
    title: "How Prime Ministers Decide",
    author: "Neerja Chowdhury",
    type: "epub",
    url: "books/how-prime-ministers-decide.epub",
  },
  {
    id: "attached",
    title: "Attached",
    author: "Amir Levine, Rachel Heller",
    type: "epub",
    url: "books/attached.epub",
  },
  {
    id: "bionic",
    title: "Bionic",
    type: "epub",
    url: "books/bionic.epub",
  },
  {
    id: "black-warrant",
    title: "Black Warrant: Confessions of a Tihar Jailer",
    type: "epub",
    url: "books/black-warrant.epub",
  },
  {
    id: "daughters-of-the-brothel",
    title: "Daughters of the Brothel",
    author: "Deepak Yadav",
    type: "epub",
    url: "books/daughters-of-the-brothel.epub",
  },
  {
    id: "delhi-a-novel",
    title: "Delhi: A Novel",
    author: "Khushwant Singh",
    type: "epub",
    url: "books/delhi-a-novel.epub",
  },
  {
    id: "delhi-darshan",
    title: "Delhi Darshan: The History and Monuments of India's Capital",
    author: "Giles Tillotson",
    type: "epub",
    url: "books/delhi-darshan.epub",
  },
  {
    id: "harry-potter-order-of-the-phoenix",
    title: "Harry Potter and the Order of the Phoenix",
    type: "epub",
    url: "books/harry-potter-order-of-the-phoenix.epub",
  },
  {
    id: "how-to-win-friends-and-influence-people",
    title: "How to Win Friends and Influence People",
    author: "Dale Carnegie",
    type: "epub",
    url: "books/how-to-win-friends-and-influence-people.epub",
  },
  {
    id: "how-to-win-friends-digital-age",
    title:
      "How to Win Friends and Influence People in the Digital Age",
    author: "Dale Carnegie and Associates",
    type: "epub",
    url: "books/how-to-win-friends-digital-age.epub",
  },
  {
    id: "latitudes-of-longing",
    title: "Latitudes of Longing",
    author: "Shubhangi Swarup",
    type: "epub",
    url: "books/latitudes-of-longing.epub",
  },
  {
    id: "lonely-planet-rajasthan-delhi-agra",
    title: "Lonely Planet Rajasthan, Delhi & Agra",
    author: "Lonely Planet",
    type: "epub",
    url: "books/lonely-planet-rajasthan-delhi-agra.epub",
  },
  {
    id: "dopamine-detox",
    title: "Dopamine Detox",
    author: "Thibaut Meurisse",
    type: "epub",
    url: "books/dopamine-detox.epub",
  },
  {
    id: "musafir-cafe",
    title: "Musafir Cafe",
    author: "Divya Prakash Dubey",
    type: "epub",
    url: "books/musafir-cafe.epub",
  },
  {
    id: "shahjahanabad",
    title: "Shahjahanabad: The Living City of Old Delhi",
    author: "Rana Safvi",
    type: "epub",
    url: "books/shahjahanabad.epub",
  },
  {
    id: "show-your-work",
    title: "Show Your Work!",
    author: "Austin Kleon",
    type: "epub",
    url: "books/show-your-work.epub",
  },
  {
    id: "steal-like-an-artist",
    title: "Steal Like an Artist!",
    author: "Austin Kleon",
    type: "epub",
    url: "books/steal-like-an-artist.epub",
  },
  {
    id: "forgotten-cities-of-delhi",
    title: "The Forgotten Cities of Delhi",
    author: "Rana Safvi",
    type: "epub",
    url: "books/forgotten-cities-of-delhi.epub",
  },
  {
    id: "dead-men-tell-tales",
    title: "Dead Men Tell Tales",
    author: "B. Umadathan",
    type: "epub",
    url: "books/dead-men-tell-tales.epub",
  },
  {
    id: "kaalkut",
    title: "Kaalkut",
    type: "epub",
    url: "books/kaalkut.epub",
  },
  {
    id: "flames-and-arrows",
    title: "Flames and Arrows",
    type: "epub",
    url: "books/flames-and-arrows.epub",
  },
  {
    id: "pinaka",
    title: "Pinaka",
    type: "epub",
    url: "books/pinaka.epub",
  },

  // ---- Remote samples ----
  {
    id: "moby-dick",
    title: "Moby Dick",
    author: "Herman Melville",
    type: "epub",
    url: "https://s3.amazonaws.com/moby-dick/moby-dick.epub",
  },
  {
    id: "tracemonkey-paper",
    title: "Trace-based JIT Type Specialization (sample PDF)",
    author: "Mozilla pdf.js demo file",
    type: "pdf",
    url: "https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf",
  },
];