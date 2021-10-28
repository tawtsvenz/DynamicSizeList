import { useRef, useState, useEffect } from "react";

import DynamicSizeList from "./DynamicSizeList";

function createStyles(count, changeWidth) {
  // generate random styles
  const styles = [];
  for (let i = 0; i < count; i++) {
    const size = Math.floor((Math.random() * 0.8 + 0.1) * 200);
    const red = Math.floor((Math.random() * 0.6 + 0.4) * 255);
    const blue = Math.floor((Math.random() * 0.6 + 0.4) * 255);
    const style = {
      height: `${changeWidth ? '95%' : size}px`,
      width: `${changeWidth ? size : '95%'}px`,
      fontWeight: 'bold',
      backgroundColor: `rgb(${red}, ${blue}, 200)`,
      border: '2px solid black',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
    }
    styles.push(style);
  }
  return styles;
}

export default function SentenceList(props) {
  const [size, setSize] = useState(null);
  const [vertical] = useState(true);
  const [scrollFromEnd] = useState(true);
  const parentRef = useRef();
  useEffect(() => {
    if (parentRef.current) {
      setSize({
        height: parentRef.current.offsetHeight,
        width: parentRef.current.offsetWidth
      });
    }
  }, [parentRef]);

  const [styles] = useState(createStyles(10000, !vertical));

  return (
    <div
      ref={parentRef}
      style={{
        height: "90vh",
        width: "90%",
        marginTop: '20px',
        marginBottom: '40px',
      }}
    >
      <DynamicSizeList
        height={size ? size.height : 600}
        width={size ? size.width : 200}
        itemCount={styles.length}
        itemSize={() => 10} // dummy. Will not be used
        overscanCount={5}
        direction={vertical ? 'vertical' : 'horizontal'}
        scrollFromEnd={scrollFromEnd}
      >
        {(index, ref) => {
          return (
            <div ref={ref} style={styles[index]}>
              {`${index}`}
            </div>
          );
        }}
      </DynamicSizeList>
    </div>
  );
}
