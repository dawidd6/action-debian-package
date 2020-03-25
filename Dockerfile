FROM docker

COPY main.sh /

ENTRYPOINT ["/main.sh"]
